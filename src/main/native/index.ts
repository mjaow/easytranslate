/**
 * Picks the platform backend, once, and re-exports it as loose functions so callers
 * read the same on either OS.
 *
 * A platform with no backend gets the null bridge: every call is a no-op and
 * `isAvailable()` is false, which the app already handles — it says text capture is
 * unavailable at startup and every hotkey press reports it rather than failing
 * silently.
 */
import { win32Bridge } from './win32.js'
import { macosBridge } from './macos.js'
import type { ButtonState, InputPermission, NativeBridge, Point } from './types.js'

export type { ButtonState, InputPermission, NativeBridge, Point } from './types.js'

const nullBridge: NativeBridge = {
  platform: process.platform,
  isAvailable: () => false,
  getLoadError: () => `EasyTranslate has no text capture for ${process.platform}.`,
  inputPermission: () => 'denied',
  clipboardSequence: () => 0,
  sendCopy: () => -1,
  foregroundWindowTitle: () => '',
  leftButtonState: () => ({ down: false, pressedSince: false }),
  cursorPosition: () => ({ x: 0, y: 0 }),
  makeNonActivating: () => false,
  clickPollMs: 15
}

/**
 * Importing a backend costs nothing on the wrong platform: neither one opens a
 * system library until its first call, and both refuse to on a platform that is
 * not theirs.
 */
function pick(): NativeBridge {
  if (process.platform === 'win32') return win32Bridge
  if (process.platform === 'darwin') return macosBridge
  return nullBridge
}

let bridge: NativeBridge | null = null

/** The backend for this platform. */
export function native(): NativeBridge {
  bridge ??= pick()
  return bridge
}

export const IS_WINDOWS = process.platform === 'win32'
export const IS_MACOS = process.platform === 'darwin'

export function isAvailable(): boolean {
  return native().isAvailable()
}

export function getLoadError(): string | null {
  return native().getLoadError()
}

export function inputPermission(): InputPermission {
  return native().inputPermission()
}

export function clipboardSequence(): number {
  return native().clipboardSequence()
}

export function sendCopy(): number {
  return native().sendCopy()
}

export function foregroundWindowTitle(): string {
  return native().foregroundWindowTitle()
}

export function leftButtonState(): ButtonState {
  return native().leftButtonState()
}

export function cursorPosition(): Point {
  return native().cursorPosition()
}

export function makeNonActivating(handle: Buffer): boolean {
  return native().makeNonActivating(handle)
}

export function clickPollMs(): number {
  return native().clickPollMs
}

/** The copy chord this platform sends, for messages the user reads. */
export function copyChordLabel(): string {
  return IS_MACOS ? '⌘C' : 'Ctrl+C'
}
