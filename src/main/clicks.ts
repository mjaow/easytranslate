/**
 * Noticing when the user clicks, anywhere on the desktop.
 *
 * There is no hook here, and nothing injected into any app. The mouse button's state
 * is simply polled — a few microseconds every few milliseconds — and a press followed
 * by a release in the same place is a click. A press that travels is a drag, which is
 * how text gets selected, and is deliberately left alone. Two clicks in the same
 * place in quick succession are a double-click, reported once, on the second.
 */
import { cursorPosition, isLeftButtonDown } from './win32.js'

/** Fast enough that no human click is missed; cheap enough to be invisible. */
const POLL_MS = 15

/** How far the pointer may travel between press and release and still be a click. */
const CLICK_SLOP_PX = 5

/** Two clicks this close together, in time and place, are one double-click. */
const DOUBLE_CLICK_MS = 500
const DOUBLE_CLICK_SLOP_PX = 8

export interface Click {
  /** Physical screen pixels, where the button was released. */
  x: number
  y: number
}

let timer: NodeJS.Timeout | null = null

export type ClickGesture = 'single' | 'double'

export function startClickWatcher(
  onClick: (click: Click) => void,
  gesture: ClickGesture = 'single'
): void {
  if (timer) return

  let wasDown = false
  let pressedAt: { x: number; y: number } | null = null
  let lastClick: { x: number; y: number; at: number } | null = null

  const report = (click: Click): void => {
    if (gesture === 'single') {
      onClick(click)
      return
    }
    const now = Date.now()
    const isSecond =
      lastClick !== null &&
      now - lastClick.at <= DOUBLE_CLICK_MS &&
      Math.hypot(click.x - lastClick.x, click.y - lastClick.y) <= DOUBLE_CLICK_SLOP_PX
    if (isSecond) {
      lastClick = null
      onClick(click)
    } else {
      lastClick = { ...click, at: now }
    }
  }

  timer = setInterval(() => {
    const down = isLeftButtonDown()
    if (down && !wasDown) {
      pressedAt = cursorPosition()
    } else if (!down && wasDown && pressedAt) {
      const released = cursorPosition()
      const travelled = Math.hypot(released.x - pressedAt.x, released.y - pressedAt.y)
      pressedAt = null
      if (travelled <= CLICK_SLOP_PX) report(released)
    }
    wasDown = down
  }, POLL_MS)

  // Never keep the process alive on its own account.
  timer.unref()
}

export function stopClickWatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export function isWatchingClicks(): boolean {
  return timer !== null
}
