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

/**
 * Convert a rectangle from device-independent to physical pixels.
 *
 * Coordinates are relative to the whole virtual desktop, so the display's own origin
 * has to be taken out before scaling and put back afterwards — scaling the absolute
 * coordinate instead would displace regions on any non-primary monitor.
 */
export function dipToPhysical(rect: Rect, display: { bounds: Rect; scaleFactor: number }): Rect {
  const { bounds, scaleFactor: scale } = display
  return {
    x: Math.round(bounds.x + (rect.x - bounds.x) * scale),
    y: Math.round(bounds.y + (rect.y - bounds.y) * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale)
  }
}

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
