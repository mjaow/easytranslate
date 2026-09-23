/**
 * The platform layer EasyTranslate sits on.
 *
 * Everything above this file — capture, the click watcher, the popup, the session —
 * is platform-neutral. Everything below it is one OS's way of doing the same five
 * things: read whether the clipboard changed, synthesise a copy, say where the
 * pointer is and whether its button is down, name the window in front, and stop a
 * window from taking focus.
 *
 * Each backend degrades to a no-op rather than throwing, so the app (and the test
 * suite) still runs on a platform that has no backend at all.
 */

/**
 * Whether the OS will let this process synthesise input.
 *
 * Windows needs no permission for it, so it reports `not-required`. macOS gates
 * `CGEventPost` behind the Accessibility permission, which the user grants in
 * System Settings — until they do, every capture silently reads nothing, so this
 * is what lets the app say so instead.
 */
export type InputPermission = 'not-required' | 'granted' | 'denied'

export interface Point {
  x: number
  y: number
}

export interface ButtonState {
  /** Whether the left mouse button is held right now. */
  down: boolean
  /**
   * Whether a press happened since the previous call — a press-and-release that
   * fell entirely between two polls. Backends that cannot answer report false and
   * poll faster instead.
   */
  pressedSince: boolean
}

export interface NativeBridge {
  readonly platform: NodeJS.Platform

  /** True when the native bindings loaded and are usable. */
  isAvailable(): boolean
  /** Why they did not load, when they didn't. */
  getLoadError(): string | null

  /**
   * Whether the OS will let this process synthesise input right now. macOS reads
   * the grant once per launch, so a permission granted while the app is running
   * only takes effect on the next start — which is why the app says so rather than
   * polling this.
   */
  inputPermission(): InputPermission

  /**
   * A counter the OS bumps on every clipboard write, by any process. Watching it is
   * how a capture knows a copy actually landed instead of sleeping and hoping.
   * Returns 0 when unavailable.
   */
  clipboardSequence(): number

  /**
   * Send a clean copy chord (Ctrl+C, or ⌘C) to whatever window has focus, with the
   * modifiers the user is still physically holding taken out of it.
   *
   * @returns how many events the OS accepted, or -1 when unavailable.
   */
  sendCopy(): number

  /** Title of the focused window — a browser's is its active tab's title. */
  foregroundWindowTitle(): string

  /** The left mouse button, for the double-click watcher. */
  leftButtonState(): ButtonState

  /** Pointer position in physical screen pixels. (0,0) when unavailable. */
  cursorPosition(): Point

  /**
   * Stop a window from ever taking focus, and confirm it stuck.
   *
   * Rule 3 of the copy-safety contract. Electron's own `focusable: false` is not
   * enough on either platform, so each backend applies the OS-level flag itself and
   * reads it back.
   *
   * @param handle Buffer from BrowserWindow.getNativeWindowHandle()
   */
  makeNonActivating(handle: Buffer): boolean

  /** How often the click watcher should poll this platform's mouse button, in ms. */
  readonly clickPollMs: number
}
