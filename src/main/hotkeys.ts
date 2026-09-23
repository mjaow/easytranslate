/**
 * Global hotkey registration.
 *
 * Hotkeys are the entire input surface of this app — there is no click-to-translate,
 * no hover, no injected page UI. That's what keeps the user's selection and clipboard
 * untouched.
 */
import { globalShortcut } from 'electron'
import type { AppConfig } from '../shared/types.js'

export type HotkeyId = 'explain'

/**
 * Accelerators we refuse to bind, whatever the config says.
 *
 * Rule 4 of the copy-safety contract: this app must never be the reason a copy or
 * paste stops working. Stealing these system-wide would do exactly that.
 */
const FORBIDDEN = new Set([
  'COMMAND+C',
  'COMMAND+V',
  'COMMAND+X',
  'COMMAND+A',
  'COMMAND+Z',
  'CONTROL+C',
  'CONTROL+V',
  'CONTROL+X',
  'CONTROL+A',
  'CONTROL+Z',
  'COMMANDORCONTROL+C',
  'COMMANDORCONTROL+V',
  'COMMANDORCONTROL+X',
  'COMMANDORCONTROL+A',
  'COMMANDORCONTROL+Z'
])

/**
 * Where to go when the preferred accelerator is already owned by something else.
 *
 * Ordered by how comfortable each is to hit one-handed while the other hand is on the
 * mouse, still holding a selection. `npm run probe:hotkeys` reports which are free on
 * a given machine.
 *
 * `CommandOrControl` keeps one list correct on both platforms. The two exceptions are
 * deliberate: ⌥E is macOS's dead key for an acute accent, so it is only offered on
 * Windows, and ⌃⌥E is offered only on macOS, where Control is otherwise unused.
 */
const MAC_ONLY = new Set(['Control+Alt+E'])
const WINDOWS_ONLY = new Set(['Alt+E'])

export const FALLBACKS: Record<HotkeyId, string[]> = {
  explain: [
    'CommandOrControl+Alt+E',
    'CommandOrControl+Alt+D',
    'CommandOrControl+Alt+Q',
    'CommandOrControl+Shift+E',
    'Control+Alt+E',
    'Alt+E',
    'F8',
    'CommandOrControl+F8'
  ].filter((candidate) =>
    process.platform === 'darwin' ? !WINDOWS_ONLY.has(candidate) : !MAC_ONLY.has(candidate)
  )
}

export interface HotkeyBinding {
  id: HotkeyId
  accelerator: string
  handler: () => void
  description: string
}

export interface RegistrationResult {
  /** What each action is actually bound to now. */
  resolved: Record<HotkeyId, string>
  /** Actions whose preferred accelerator was unavailable and had to move. */
  reassigned: { id: HotkeyId; description: string; wanted: string; got: string }[]
  /** Actions that could not be bound at all. */
  failed: { id: HotkeyId; description: string; wanted: string; why: string }[]
}

function normalize(accelerator: string): string {
  return accelerator.toUpperCase().replace(/\s+/g, '')
}

export function isForbidden(accelerator: string): boolean {
  return FORBIDDEN.has(normalize(accelerator))
}

/** Try to bind one accelerator. Returns why it failed, or null on success. */
function tryRegister(accelerator: string, handler: () => void): string | null {
  if (!accelerator) return 'empty'
  if (isForbidden(accelerator)) return 'would shadow a clipboard shortcut'
  try {
    // register() returns false — it does not throw — when another process owns it.
    return globalShortcut.register(accelerator, handler) ? null : 'already taken by another app'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Replace all bindings, falling back to a free accelerator when the preferred one is
 * taken.
 *
 * Refusing to bind anything would leave the app with no way to be invoked at all —
 * for a hotkey-driven tool that means completely dead. Moving to a working key and
 * saying so is far more useful than an error and nothing.
 */
export function registerHotkeys(bindings: HotkeyBinding[]): RegistrationResult {
  unregisterHotkeys()
  const result: RegistrationResult = {
    resolved: { explain: '' },
    reassigned: [],
    failed: []
  }

  for (const { id, accelerator, handler, description } of bindings) {
    const problem = tryRegister(accelerator, handler)
    if (problem === null) {
      result.resolved[id] = accelerator
      continue
    }

    // Preferred key is unavailable — walk the fallbacks for this action.
    const alternative = FALLBACKS[id].find(
      (candidate) => candidate !== accelerator && tryRegister(candidate, handler) === null
    )

    if (alternative) {
      result.resolved[id] = alternative
      result.reassigned.push({ id, description, wanted: accelerator, got: alternative })
    } else {
      result.failed.push({ id, description, wanted: accelerator, why: problem })
    }
  }
  return result
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll()
}

/**
 * Whether an accelerator can be bound right now. Used for live checks in Settings.
 *
 * Every Electron call here is inside the try, not just the registration: macOS
 * throws out of `isRegistered` on an accelerator it cannot parse, where Windows
 * simply answers false. Settings asks this on every keystroke of the recorder, so
 * one unparseable chord must report "not a valid shortcut", never take the handler
 * down with it.
 */
export function checkAvailability(accelerator: string): { ok: boolean; why?: string } {
  if (!accelerator.trim()) return { ok: false, why: 'Enter a shortcut.' }
  if (isForbidden(accelerator)) {
    return { ok: false, why: 'Refused — this would shadow a clipboard shortcut.' }
  }
  try {
    // Skip anything we currently hold, otherwise we'd report our own binding as taken.
    if (globalShortcut.isRegistered(accelerator)) return { ok: true }
    const got = globalShortcut.register(accelerator, () => {})
    if (got) globalShortcut.unregister(accelerator)
    return got ? { ok: true } : { ok: false, why: 'Already taken by another application.' }
  } catch {
    return { ok: false, why: 'Not a valid shortcut.' }
  }
}

export function bindingsFor(
  config: AppConfig,
  handlers: { explain: () => void }
): HotkeyBinding[] {
  return [
    {
      id: 'explain',
      accelerator: config.hotkeys.explain,
      handler: handlers.explain,
      description: 'Explain selection'
    }
  ]
}
