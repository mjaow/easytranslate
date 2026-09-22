/**
 * The macOS backend of the platform layer (see ./types.ts).
 *
 * The Windows original and this file do the same five things by different means:
 *
 *   clipboard sequence  GetClipboardSequenceNumber  ->  NSPasteboard.changeCount
 *   synthetic copy      SendInput(Ctrl+C)           ->  CGEventPost(Cmd+C)
 *   pointer + button    GetCursorPos/GetAsyncKeyState -> CGEvent / CGEventSourceButtonState
 *   window in front     GetWindowTextW              ->  AXFocusedWindow -> AXTitle
 *   never take focus    WS_EX_NOACTIVATE            ->  canBecomeKeyWindow == NO
 *
 * Core Graphics is plain C, so koffi reaches it directly. The two things that have
 * no C surface — the pasteboard's change counter and a window's own view of whether
 * it may take focus — go through the Objective-C runtime in ./objc.ts, which is also
 * plain C.
 *
 * One difference matters to the user: macOS will not let any process synthesise a
 * keystroke until it has been granted Accessibility. Until then `sendCopy` posts
 * events that go nowhere, so `inputPermission()` exists to say so up front rather
 * than letting every lookup fail mutely.
 */
import koffi from 'koffi'
import { cfStringToJs, objc, type Ref } from './objc.js'
import { axAvailable, axTrusted, focusedWindowTitle } from './ax.js'
import type { ButtonState, InputPermission, NativeBridge, Point } from './types.js'

// --- virtual key codes (Carbon kVK_*) ---------------------------------------
const kVK_ANSI_C = 0x08
const MODIFIER_KEYS = [
  0x37, // kVK_Command
  0x36, // kVK_RightCommand
  0x38, // kVK_Shift
  0x3c, // kVK_RightShift
  0x3a, // kVK_Option
  0x3d, // kVK_RightOption
  0x3b, // kVK_Control
  0x3e // kVK_RightControl
]

/** CGEventFlags. Only Command is ever set — that is the whole point of sendCopy. */
const kCGEventFlagMaskCommand = 0x00100000

/** CGEventSourceStateID. Private keeps our synthetic events out of the global state. */
const kCGEventSourceStatePrivate = -1
const kCGEventSourceStateCombinedSessionState = 0

/** CGEventTapLocation. The session tap is where an app's own key handling listens. */
const kCGSessionEventTap = 1

const CGPointStruct = koffi.struct('MacCGPoint', { x: 'double', y: 'double' })

interface Bindings {
  eventCreate: (source: Ref) => Ref
  eventGetLocation: (event: Ref) => { x: number; y: number }
  eventSourceCreate: (state: number) => Ref
  keyboardEvent: (source: Ref, key: number, down: boolean) => Ref
  setFlags: (event: Ref, flags: number) => void
  post: (tap: number, event: Ref) => void
  buttonState: (state: number, button: number) => boolean
  keyState: (state: number, key: number) => boolean
  release: (obj: Ref) => void
}

let bindings: Bindings | null = null
let loadError: string | null = null

export const IS_MACOS = process.platform === 'darwin'

function load(): Bindings | null {
  if (!IS_MACOS) return null
  if (bindings || loadError) return bindings

  try {
    const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')

    bindings = {
      eventCreate: cg.func('CGEventCreate', 'void *', ['void *']),
      eventGetLocation: cg.func('CGEventGetLocation', CGPointStruct, ['void *']),
      eventSourceCreate: cg.func('CGEventSourceCreate', 'void *', ['int32']),
      keyboardEvent: cg.func('CGEventCreateKeyboardEvent', 'void *', ['void *', 'uint16', 'bool']),
      setFlags: cg.func('CGEventSetFlags', 'void', ['void *', 'uint64']),
      post: cg.func('CGEventPost', 'void', ['uint32', 'void *']),
      buttonState: cg.func('CGEventSourceButtonState', 'bool', ['int32', 'uint32']),
      keyState: cg.func('CGEventSourceKeyState', 'bool', ['int32', 'uint16']),
      release: cf.func('CFRelease', 'void', ['void *'])
    }

    // The Objective-C runtime is not optional: without it there is no change counter,
    // and without that a capture cannot tell a slow app from one that ignored the copy.
    if (!objc()) throw new Error('the Objective-C runtime did not load')

    return bindings
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err)
    console.error('[macos] failed to load the Core Graphics bindings:', loadError)
    return null
  }
}

export function isAvailable(): boolean {
  return load() !== null
}

export function getLoadError(): string | null {
  load()
  return loadError
}

/**
 * macOS refuses synthetic keyboard events from a process the user has not granted
 * Accessibility, and refuses them silently — the events are created and posted and
 * simply never arrive. Reading the trust flag is the only way to tell that apart
 * from "nothing was selected".
 */
function inputPermission(): InputPermission {
  if (!IS_MACOS || !axAvailable()) return 'denied'
  return axTrusted() ? 'granted' : 'denied'
}

// --------------------------------------------------------------- pasteboard

let pasteboard: Ref = null
let changeCountSel: Ref = null

/**
 * `[[NSPasteboard generalPasteboard] changeCount]` — the counter macOS bumps on
 * every pasteboard write, by any process. The exact analogue of Windows'
 * GetClipboardSequenceNumber, and the reason a capture can watch for a copy landing
 * instead of sleeping a fixed time and hoping.
 *
 * The general pasteboard is a singleton, so it is looked up once and kept.
 */
export function clipboardSequence(): number {
  const o = objc()
  if (!o || !load()) return 0
  try {
    if (!pasteboard) {
      const cls = o.getClass('NSPasteboard')
      if (!cls) return 0
      pasteboard = o.msgSend0(cls, o.sel('generalPasteboard'))
      changeCountSel = o.sel('changeCount')
    }
    if (!pasteboard) return 0
    return Number(o.msgSendInt(pasteboard, changeCountSel))
  } catch (err) {
    console.error('[macos] could not read the pasteboard change count:', err)
    return 0
  }
}

// ------------------------------------------------------------------- copy

/**
 * Send a clean ⌘C to whatever window has focus.
 *
 * Same subtlety as on Windows, and the same answer. The hotkey is itself a chord
 * (⌘⌥E by default), so at the moment it fires the user is still physically holding
 * Command and Option; a naive ⌘C would reach the target as ⌘⌥C and copy nothing.
 * So every modifier the OS reports as down is released first, and the copy carries
 * an explicit flag mask of Command alone, which overrides whatever the hardware
 * state says.
 *
 * As on Windows, the modifiers are deliberately not re-pressed: the user's fingers
 * are still on them, so the real key-ups are still coming and re-pressing risks a
 * stuck modifier.
 *
 * @returns the number of events posted, or -1 when the bindings are unavailable.
 */
export function sendCopy(): number {
  const b = load()
  if (!b) return -1

  let source: Ref = null
  // Every event this call creates, so the finally releases them whichever way it
  // leaves — a Core Foundation object is not garbage collected.
  const created: Ref[] = []
  let sent = 0

  const create = (key: number, down: boolean, flags: number): Ref => {
    const event = b.keyboardEvent(source, key, down)
    if (!event) return null
    created.push(event)
    b.setFlags(event, flags)
    return event
  }

  try {
    source = b.eventSourceCreate(kCGEventSourceStatePrivate)

    for (const key of MODIFIER_KEYS) {
      if (!b.keyState(kCGEventSourceStateCombinedSessionState, key)) continue
      const release = create(key, false, 0)
      if (!release) continue
      b.post(kCGSessionEventTap, release)
      sent++
    }

    const down = create(kVK_ANSI_C, true, kCGEventFlagMaskCommand)
    const up = create(kVK_ANSI_C, false, kCGEventFlagMaskCommand)
    if (!down || !up) return sent

    b.post(kCGSessionEventTap, down)
    b.post(kCGSessionEventTap, up)
    return sent + 2
  } catch (err) {
    console.error('[macos] sendCopy failed:', err)
    return -1
  } finally {
    for (const event of created) b.release(event)
    if (source) b.release(source)
  }
}

// -------------------------------------------------------- pointer and button

/** Pointer position in screen points, which on macOS are what every API here uses. */
export function cursorPosition(): Point {
  const b = load()
  if (!b) return { x: 0, y: 0 }
  let event: Ref = null
  try {
    event = b.eventCreate(null)
    if (!event) return { x: 0, y: 0 }
    const point = b.eventGetLocation(event)
    return { x: point.x, y: point.y }
  } catch {
    return { x: 0, y: 0 }
  } finally {
    if (event) b.release(event)
  }
}

/**
 * The left mouse button.
 *
 * Unlike GetAsyncKeyState, CGEventSourceButtonState has no "was pressed since you
 * last asked" bit, so a press and release falling entirely between two polls cannot
 * be recovered after the fact. The answer is to poll faster instead — see
 * `clickPollMs` below — rather than to guess.
 */
export function leftButtonState(): ButtonState {
  const b = load()
  if (!b) return { down: false, pressedSince: false }
  try {
    return { down: b.buttonState(kCGEventSourceStateCombinedSessionState, 0), pressedSince: false }
  } catch {
    return { down: false, pressedSince: false }
  }
}

export function foregroundWindowTitle(): string {
  if (!IS_MACOS) return ''
  try {
    return focusedWindowTitle()
  } catch {
    return ''
  }
}

// ------------------------------------------------------------------- popup

/**
 * Confirm the popup's window can never take focus.
 *
 * Rule 3 of the copy-safety contract, in macOS's terms. What matters is not which
 * flag is set but that the window cannot become key or main: a window that cannot
 * become key never receives the focus, so the user's selection stays alive and their
 * ⌘V keeps working — the same property WS_EX_NOACTIVATE buys on Windows.
 *
 * Electron gives that from `focusable: false`, which makes `canBecomeKeyWindow`
 * answer NO. So there is nothing to set here, and everything to check: "we passed
 * the option" is not good enough for the thing the whole app rests on, so both
 * flags are read off the real NSWindow.
 *
 * The tempting alternative, `type: 'panel'` and the non-activating panel style, does
 * not work: as of Electron 44 the window it builds is a plain NSWindow, AppKit
 * refuses the style with "NSWindow does not support nonactivating panel styleMask",
 * and the window then never becomes ready to show at all.
 *
 * The other half of the guarantee is not a window flag: `app.dock.hide()` makes this
 * an accessory application, and an accessory application does not come forward when
 * one of its windows appears.
 *
 * @param handle Buffer from BrowserWindow.getNativeWindowHandle() — it holds an
 *               NSView pointer as its contents, not at its address.
 */
export function makeNonActivating(handle: Buffer): boolean {
  const o = objc()
  if (!o || !load()) return false
  try {
    if (handle.length < 8) return false
    const view = handle.readBigUInt64LE(0)
    if (view === 0n) return false

    const window = o.msgSendAt(view, o.sel('window'))
    if (!window) {
      console.error('[macos] the popup view has no window yet')
      return false
    }

    const canBecomeKey = o.msgSendFlag(window, o.sel('canBecomeKeyWindow'))
    const canBecomeMain = o.msgSendFlag(window, o.sel('canBecomeMainWindow'))
    const stuck = !canBecomeKey && !canBecomeMain
    if (!stuck) {
      console.error(
        `[macos] the popup can still take focus (key=${canBecomeKey}, main=${canBecomeMain})`
      )
    }
    return stuck
  } catch (err) {
    console.error('[macos] makeNonActivating failed:', err)
    return false
  }
}

/** Only used to explain a failure — the focused app's name, if it has one. */
export function describeFocusedApp(): string {
  const o = objc()
  if (!o) return ''
  try {
    const workspace = o.getClass('NSWorkspace')
    if (!workspace) return ''
    const shared = o.msgSend0(workspace, o.sel('sharedWorkspace'))
    const application = shared ? o.msgSend0(shared, o.sel('frontmostApplication')) : null
    const name = application ? o.msgSend0(application, o.sel('localizedName')) : null
    return name ? cfStringToJs(name) : ''
  } catch {
    return ''
  }
}

export const macosBridge: NativeBridge = {
  platform: 'darwin',
  isAvailable,
  getLoadError,
  inputPermission,
  clipboardSequence,
  sendCopy,
  foregroundWindowTitle,
  leftButtonState,
  cursorPosition,
  makeNonActivating,
  // No "pressed since you last asked" bit here, so the poll itself has to be quick
  // enough to straddle a real click: a human press-and-release is 30ms at its very
  // fastest, and 8ms of a microsecond call is still invisible.
  clickPollMs: 8
}
