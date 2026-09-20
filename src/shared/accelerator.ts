/**
 * Turning a keypress into an Electron accelerator, and back into something readable.
 *
 * Kept free of Electron and DOM types so it can be unit tested directly.
 */

/** The parts of a KeyboardEvent we care about. */
export interface KeyChord {
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  /** Physical key, e.g. "KeyE", "Digit1", "F9". Layout-independent. */
  code: string
}

/** Keys that are only modifiers — pressing one alone is not a shortcut. */
const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/

/**
 * Physical code → Electron key name.
 *
 * `code` rather than `key` deliberately: `key` changes with the keyboard layout and
 * with Shift, so Shift+1 would record as "!" and a French layout would record "A" as
 * "Q". The physical key is what the user actually presses.
 */
function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`

  const named: Record<string, string> = {
    Space: 'Space',
    Enter: 'Return',
    NumpadEnter: 'Return',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Backquote: '`',
    Comma: ',',
    Period: '.',
    Slash: '/'
  }
  return named[code] ?? null
}

export type RecordResult =
  | { ok: true; accelerator: string }
  | { ok: false; reason: 'modifier-only' | 'needs-modifier' | 'unsupported-key' }

/**
 * Build an Electron accelerator from a keypress.
 *
 * Ctrl (Windows) and Command (macOS) both become `CommandOrControl`, so one stored
 * shortcut is correct on either platform rather than being tied to the machine it was
 * recorded on.
 */
export function toAccelerator(e: KeyChord): RecordResult {
  if (MODIFIER_CODES.test(e.code)) return { ok: false, reason: 'modifier-only' }

  const key = keyName(e.code)
  if (!key) return { ok: false, reason: 'unsupported-key' }

  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  // A global shortcut with no modifier would swallow that key everywhere. Function
  // keys are the usual exception — they're not used for typing.
  const isFunctionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(key)
  if (parts.length === 0 && !isFunctionKey) return { ok: false, reason: 'needs-modifier' }

  parts.push(key)
  return { ok: true, accelerator: parts.join('+') }
}

/** Render an accelerator the way the current platform labels its keys. */
export function formatAccelerator(accelerator: string, isMac = false): string {
  if (!accelerator) return ''
  return accelerator
    .split('+')
    .map((part) => {
      switch (part) {
        case 'CommandOrControl':
        case 'CmdOrCtrl':
          return isMac ? '⌘' : 'Ctrl'
        case 'Command':
        case 'Cmd':
          return '⌘'
        case 'Control':
          return isMac ? '⌃' : 'Ctrl'
        case 'Alt':
          return isMac ? '⌥' : 'Alt'
        case 'Shift':
          return isMac ? '⇧' : 'Shift'
        case 'Super':
          return isMac ? '⌘' : 'Win'
        case 'Return':
          return 'Enter'
        default:
          return part
      }
    })
    .join(isMac ? '' : ' + ')
}
