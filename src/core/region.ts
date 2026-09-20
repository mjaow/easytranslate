/**
 * Rectangle maths for the screen snip.
 *
 * Kept pure and free of Electron so it can be tested directly. This is where the
 * feature is most likely to go wrong: Electron reports device-independent pixels while
 * Win32 wants physical ones, and a display at 150% scaling exposes any confusion
 * between the two.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A remembered snip region, tied to the display it was drawn on. */
export interface SnipRegion extends Rect {
  /** Which display it belongs to; a region is meaningless once that display is gone. */
  displayId: number
}

/** Normalise a drag into a rectangle, whichever direction it was drawn. */
export function rectFromDrag(
  start: { x: number; y: number },
  end: { x: number; y: number }
): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  }
}

/** Smallest region worth reading — below this it's a stray click, not a selection. */
export const MIN_REGION = 8

export function isUsableRegion(rect: Rect): boolean {
  return rect.width >= MIN_REGION && rect.height >= MIN_REGION
}

/*
 * There is deliberately no DIP-to-physical conversion here.
 *
 * An earlier version computed it as `origin + (x - origin) * scaleFactor`, which is
 * only correct for a primary display at (0,0). With several monitors — especially one
 * at negative coordinates, which Windows uses for a display to the left — a display's
 * physical origin is not its DIP origin at all, and regions landed somewhere else
 * entirely. Electron's screen.dipToScreenRect() knows the whole desktop layout and is
 * used instead, in src/main/overlay.ts.
 */

/** Clamp a rectangle so it cannot extend past the display it belongs to. */
export function clampToDisplay(rect: Rect, bounds: Rect): Rect {
  const x = Math.max(bounds.x, Math.min(rect.x, bounds.x + bounds.width))
  const y = Math.max(bounds.y, Math.min(rect.y, bounds.y + bounds.height))
  return {
    x,
    y,
    width: Math.max(0, Math.min(rect.width, bounds.x + bounds.width - x)),
    height: Math.max(0, Math.min(rect.height, bounds.y + bounds.height - y))
  }
}

/**
 * Whether a remembered region can still be used.
 *
 * A region outlives the session that made it, so the display may have been unplugged
 * or rearranged since. Snipping blind would grab whatever now occupies those
 * coordinates, which is worse than asking again.
 */
export function regionIsStillValid(
  region: SnipRegion | null,
  displays: { id: number; bounds: Rect }[]
): boolean {
  if (!region || !isUsableRegion(region)) return false
  const display = displays.find((d) => d.id === region.displayId)
  if (!display) return false

  const clamped = clampToDisplay(region, display.bounds)
  return isUsableRegion(clamped)
}
