/**
 * Reads the user's current selection from whatever app has focus, without disturbing it.
 *
 * This module is the whole reason EasyTranslate isn't a browser extension. Extensions
 * have to inject overlay DOM next to your selection to offer click-to-translate, and
 * that overlay collapses the selection — which is why they break Ctrl+C. We run
 * entirely outside the page: nothing of ours touches the DOM, so the selection and the
 * clipboard both survive.
 *
 * The clipboard IS borrowed for a few milliseconds, so the contract is:
 * snapshot everything, copy, read, put the original back.
 */
import { clipboard, ClipboardItem } from 'electron'
import type { CaptureFailure, CaptureResult } from '../shared/types.js'
import { clipboardSequence, sendCopy, isAvailable } from './native/index.js'

/**
 * How long to wait for the target app to respond to Ctrl+C before trying again.
 *
 * Only paid on the failure path — a successful capture returns as soon as the
 * copied text is readable, typically under 30ms. The budget is generous
 * because heavy pages (news sites loaded with ad scripts) can block their main
 * thread long enough to miss a tight deadline, and a false "nothing selected" is
 * far more annoying than an extra second when something really is wrong.
 */
const COPY_TIMEOUT_MS = 700
const POLL_INTERVAL_MS = 10

/**
 * How many times to send the copy before giving up.
 *
 * A single synthetic keystroke can be swallowed — during a focus transition, or
 * while the target's message loop is busy. One retry costs nothing on success and
 * rescues a noticeable share of failures. Found on a wsj.com article, where capture
 * failed while a manual Ctrl+C worked fine.
 */
const COPY_ATTEMPTS = 2

/** One clipboard entry, as a map of MIME type to its payload. */
type ItemPayload = Record<string, Blob | string | Electron.ClipboardBookmark>

/**
 * Capture every format the platform is currently offering.
 *
 * Electron's clipboard API is format-agnostic: `read()` reports whatever MIME types
 * are on the clipboard, whatever they are, so we no longer have to enumerate the
 * formats we know how to handle. That means file drops and app-private formats —
 * an Excel cell range, say — survive the round trip too, which the old fixed
 * text/HTML/RTF/image snapshot could not manage.
 */
async function snapshot(): Promise<ItemPayload[]> {
  try {
    const items = await clipboard.read()
    const out: ItemPayload[] = []

    for (const item of items) {
      const payload: ItemPayload = {}
      for (const type of item.types) {
        try {
          payload[type] = await item.getType(type)
        } catch {
          // A type can be advertised but fail to produce data. Skip it rather than
          // abandoning the formats that did read cleanly.
        }
      }
      if (Object.keys(payload).length > 0) out.push(payload)
    }
    return out
  } catch (err) {
    console.error('[capture] could not snapshot the clipboard:', err)
    return []
  }
}

async function restore(snap: ItemPayload[]): Promise<void> {
  try {
    if (snap.length === 0) {
      clipboard.clear()
      return
    }
    await clipboard.write(snap.map((payload) => new ClipboardItem(payload)))
  } catch (err) {
    // Never let a restore failure take the app down — the user still gets their
    // explanation, they just lost a clipboard they probably weren't using.
    console.error('[capture] clipboard restore failed:', err)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Wait for *any* process to write the clipboard, by watching the OS sequence counter.
 *
 * This is deliberately not a fixed sleep. A blind `await sleep(300)` is both slower
 * than it needs to be on fast apps and unreliable on slow ones, and it can't tell
 * "this app is slow" apart from "this app ignored Ctrl+C entirely" — a distinction we
 * need in order to show a useful error.
 */
async function waitForClipboardWrite(before: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    if (clipboardSequence() !== before) return true
  }
  return false
}

/**
 * A sequence change can mean the producer has cleared the clipboard but has not
 * finished publishing text yet. Reads can also fail while another process holds
 * the clipboard open. Keep reading within a bounded budget; do not send Ctrl+C
 * again after a write, since copying can clear a terminal's selection and the
 * next Ctrl+C would interrupt its running command.
 */
async function readCopiedText(timeoutMs: number): Promise<
  { ok: true; text: string } | { ok: false; reason: CaptureFailure }
> {
  const deadline = Date.now() + timeoutMs
  let readFailed = false

  while (true) {
    try {
      const text = await clipboard.readText()
      if (text.trim()) return { ok: true, text }
      readFailed = false
    } catch {
      readFailed = true
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await sleep(Math.min(POLL_INTERVAL_MS, remaining))
  }

  if (readFailed) return { ok: false, reason: 'unreadable' }

  try {
    // Electron 44 returns an item even for an empty clipboard. Inspect its
    // formats, not the array length. Whitespace-only plain text is also empty.
    const types = (await clipboard.read()).flatMap((item) => item.types)
    return {
      ok: false,
      reason: types.length === 0 || types.includes('text/plain') ? 'empty' : 'not-text'
    }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

/**
 * Grab the current selection. Always leaves the clipboard exactly as it found it.
 */
export async function captureSelection(
  timeoutMs = COPY_TIMEOUT_MS,
  attempts = COPY_ATTEMPTS
): Promise<CaptureResult> {
  const started = Date.now()

  if (!isAvailable()) {
    return { ok: false, reason: 'no-response', elapsedMs: 0 }
  }

  const snap = await snapshot()
  const seqBefore = clipboardSequence()

  let wrote = false
  for (let attempt = 0; attempt < attempts && !wrote; attempt++) {
    sendCopy()
    wrote = await waitForClipboardWrite(seqBefore, timeoutMs)
  }

  if (!wrote) {
    // Nothing was written, so the clipboard still holds the user's content untouched.
    // Causes, roughly in order of likelihood: nothing is actually selected; the page
    // blocks the copy event; or the target window is elevated and Windows silently
    // dropped our synthetic input (UIPI).
    return { ok: false, reason: 'no-response', elapsedMs: Date.now() - started }
  }

  try {
    const result = await readCopiedText(timeoutMs)
    const elapsedMs = Date.now() - started
    if (!result.ok) return { ...result, elapsedMs }
    return { ok: true, text: normalize(result.text), raw: keepShape(result.text), elapsedMs }
  } finally {
    await restore(snap)
  }
}

/**
 * The selection as selected, minus what no reader wants: Windows line endings, the
 * non-breaking spaces some pages indent with, trailing whitespace, and the
 * indentation the whole block shares because it was selected from inside something.
 * Line breaks stay — for code they are the structure, and a model reading prose
 * copes with hard-wrapping perfectly well.
 */
export function keepShape(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)?.[0].length ?? 0)
  const common = indents.length ? Math.min(...indents) : 0
  return lines.map((l) => l.slice(Math.min(common, l.length))).join('\n')
}

/**
 * Tidy copied text into something worth sending to a model: collapse the hard-wrapping
 * and stray whitespace that PDFs and chat apps introduce, without touching real
 * paragraph breaks.
 */
export function normalize(raw: string): string {
  return stripTimestamps(raw.replace(/\r\n?/g, '\n'))
    .replace(/ /g, ' ')
    // A single newline inside a paragraph is almost always hard-wrapping; two or more
    // is a real break. Collapse the former, keep the latter.
    .replace(/([^\n])\n(?!\n)/g, '$1 ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Drop the leading timestamp from each line of a video transcript.
 *
 * Selecting from a transcript panel — YouTube's, or any player's — gives lines like
 * "0:15  you're on a campus and". The timestamps are noise to a reader and worse to a
 * model, which will dutifully try to account for them; they also clutter the popup
 * headline. Only a timestamp at the very start of a line is removed, so a time
 * mentioned within a sentence survives.
 */
function stripTimestamps(raw: string): string {
  return raw.replace(/^[ \t]*\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?[ \t]+(?=\S)/gm, '')
}

export const __testing = { snapshot, restore, normalize, stripTimestamps }
