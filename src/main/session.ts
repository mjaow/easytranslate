/**
 * Orchestrates one lookup: capture → explain → stream into the popup.
 */
import { app, BrowserWindow, screen } from 'electron'
import { appendFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExplainRequest, ExplainState } from '../shared/types.js'
import { captureSelection } from './capture.js'
import { readScreenRegion } from './ocr.js'
import { readTranscriptAtPoint } from './uia.js'
import { pickRegion, isPicking } from './overlay.js'
import { foregroundWindowTitle } from './win32.js'
import { assessReadability } from '../core/readable.js'
import { showPopup, updatePopup, hidePopup, isPopupVisible } from './popup.js'
import { detectMode, SectionParser } from '../core/explain.js'
import { loadConfig, getSecret } from '../core/config.js'
import { JsonLruCache, AudioCache, cacheKey } from '../core/cache.js'
import { createLlmProvider, describeError } from '../providers/llm/registry.js'
import { speak } from '../providers/tts/registry.js'
import type { Explanation } from '../shared/types.js'

let explanationCache: JsonLruCache<Explanation> | null = null
let audioCache: AudioCache | null = null

function caches(): { explanations: JsonLruCache<Explanation>; audio: AudioCache } {
  explanationCache ??= new JsonLruCache<Explanation>(join(app.getPath('userData'), 'explanations.json'))
  audioCache ??= new AudioCache(join(app.getPath('userData'), 'audio'))
  return { explanations: explanationCache, audio: audioCache }
}

let inFlight: AbortController | null = null
/** Picking and reading takes a second or two; a second press must not start a rival. */
let reading = false
/** One accessibility read at a time — clicks can come faster than PowerShell starts. */
let clickInFlight = false

function cancelInFlight(): void {
  inFlight?.abort()
  inFlight = null
}

function emit(state: ExplainState, isNew: boolean): void {
  if (isNew) showPopup(state)
  else updatePopup(state)
}

function showError(message: string, action?: ExplainState['action']): void {
  showPopup({ mode: 'passage', text: '', explanation: {}, status: 'error', error: message, action })
}

/**
 * The hotkey: explain the selection, or — when nothing is selected — let the user
 * drag a box over part of the screen and explain what it says.
 *
 * Two gestures, one key. A selection always wins, because it is exact; the screen is
 * for what cannot be selected, such as subtitles on a video.
 */
export async function explainOrPick(preloadPath: string): Promise<void> {
  cancelInFlight()

  const selection = await captureSelection(400, 1)
  if (selection.ok) {
    await run({ mode: detectMode(selection.text), text: selection.text }, true)
    return
  }

  await pickAndRead(preloadPath)
}

/**
 * Drag a box over part of the screen, read the text in it, explain it.
 *
 * The region is chosen fresh every time. Everything past the OCR call is the
 * ordinary explain path — a screen read and a selection are indistinguishable from
 * there on.
 */
export async function pickAndRead(preloadPath: string): Promise<void> {
  if (reading) return
  reading = true
  try {
    cancelInFlight()

    const region = await pickRegion(preloadPath)
    if (!region) return // cancelled — say nothing

    // Let the overlay finish disappearing, or it ends up in its own screenshot.
    await new Promise((r) => setTimeout(r, 150))

    // Acknowledge at once. Capture and OCR take over a second, and without this the
    // gesture feels like it did nothing at all.
    showPopup({ mode: 'passage', text: 'Reading the screen…', explanation: {}, status: 'streaming' })

    const result = await readScreenRegion(region)
    if (!result.ok) {
      showError(result.reason, { id: 'read-screen', label: 'Try another area' })
      return
    }

    // A misread is worse than a failure: the model will explain nonsense with a
    // straight face, and it reads like a real answer. Say so instead.
    if (!assessReadability(result.text).readable) {
      showError(
        `That area did not read as text — "${result.text.slice(0, 40)}". ` +
          'Try drawing the box more tightly around the words.',
        { id: 'read-screen', label: 'Try another area' }
      )
      return
    }

    await run({ mode: detectMode(result.text), text: result.text }, false)
  } finally {
    reading = false
  }
}

/**
 * Windows whose clicks are worth a look. A browser's title is its active tab's, so
 * this is "a YouTube tab is in front" — the only place transcripts are clicked.
 */
const VIDEO_WINDOW_TITLES = ['YouTube']

function isOverOwnWindow(dip: { x: number; y: number }): boolean {
  return BrowserWindow.getAllWindows().some((win) => {
    if (win.isDestroyed() || !win.isVisible()) return false
    const b = win.getBounds()
    return dip.x >= b.x && dip.x < b.x + b.width && dip.y >= b.y && dip.y < b.y + b.height
  })
}

/** Keep recent misses, and start over once the file gets big rather than grow forever. */
async function logMiss(entry: string): Promise<void> {
  const file = join(app.getPath('userData'), 'last-click.log')
  try {
    const size = await stat(file).then((s) => s.size, () => 0)
    if (size > 200_000) await writeFile(file, entry)
    else await appendFile(file, entry)
  } catch {
    // Diagnostics must never get in the way of the click itself.
  }
}

/**
 * The user double-clicked somewhere. If it was a transcript line, explain it.
 *
 * Nothing is read unless a video page is in front, and nothing is shown unless the
 * click was on a line of transcript — the video itself, a related video, the
 * comments all stay plain clicks. Misses on a video page are written to
 * last-click.log in the data folder, so a line that fails to register can be
 * diagnosed rather than guessed at.
 */
export async function explainClickedTranscript(click: { x: number; y: number }): Promise<void> {
  if (clickInFlight || reading || isPicking()) return

  const title = foregroundWindowTitle()
  if (!VIDEO_WINDOW_TITLES.some((t) => title.includes(t))) return
  if (isOverOwnWindow(screen.screenToDipPoint(click))) return

  clickInFlight = true
  try {
    const { text, read } = await readTranscriptAtPoint(click.x, click.y)
    if (!text) {
      const report = read
        ? [`button: ${read.button ?? '-'}`, `line: ${read.line ?? '-'}`, read.chain].join('\n')
        : 'the accessibility read returned nothing'
      void logMiss(
        [`${new Date().toISOString()}  ${title}`, `at ${click.x},${click.y}`, report, '', ''].join('\n')
      )
      return
    }
    cancelInFlight()
    await run({ mode: detectMode(text), text }, true)
  } finally {
    clickInFlight = false
  }
}

async function run(req: ExplainRequest, isNew: boolean): Promise<void> {
  const config = loadConfig()
  const { explanations } = caches()
  const key = cacheKey(
    config.llm.provider,
    config.llm.models[config.llm.provider],
    req.mode,
    req.text,
    req.context
  )

  const cached = explanations.get(key)
  if (cached) {
    emit(
      { mode: req.mode, text: req.text, context: req.context, explanation: cached, status: 'done' },
      isNew
    )
    return
  }

  const state: ExplainState = {
    mode: req.mode,
    text: req.text,
    context: req.context,
    explanation: {},
    status: 'streaming'
  }
  emit(state, isNew)

  let provider
  try {
    provider = createLlmProvider(config, getSecret(config.llm.provider))
  } catch (err) {
    const e = describeError(config.llm.provider, err)
    emit({ ...state, status: 'error', error: [e.message, e.hint].filter(Boolean).join(' ') }, false)
    return
  }

  const controller = new AbortController()
  inFlight = controller
  const parser = new SectionParser()

  try {
    for await (const chunk of provider.explain(req, controller.signal)) {
      if (controller.signal.aborted) return
      state.explanation = parser.push(chunk)
      updatePopup(state)
    }
    state.explanation = parser.end()
    state.status = 'done'

    // Only cache a result that actually parsed — caching an empty or malformed
    // answer would make a transient failure permanent.
    if (Object.keys(state.explanation).length > 0) explanations.set(key, state.explanation)
    updatePopup(state)
  } catch (err) {
    if (controller.signal.aborted) return
    const e = describeError(config.llm.provider, err)
    state.status = 'error'
    state.error = [e.message, e.hint].filter(Boolean).join(' ')
    updatePopup(state)
  } finally {
    if (inFlight === controller) inFlight = null
  }
}

/**
 * Synthesize speech for the popup, serving from disk when we've said it before.
 * @returns a data URL the renderer can hand straight to an <audio> element.
 */
export async function synthesize(
  text: string,
  slow: boolean
): Promise<{ url: string; usedProvider: string; fallbackReason?: string }> {
  const config = loadConfig()
  const { audio } = caches()
  const rate = slow ? config.tts.slowRate : 0
  const voice =
    config.tts.provider === 'online'
      ? `${config.tts.azureRegion}/${config.tts.azureVoice}`
      : config.tts.systemVoice
  const key = cacheKey(config.tts.provider, voice, String(rate), text)

  for (const ext of ['mp3', 'wav'] as const) {
    const hit = audio.get(key, ext)
    if (hit) {
      const mime = ext === 'mp3' ? 'audio/mpeg' : 'audio/wav'
      return { url: `data:${mime};base64,${hit.toString('base64')}`, usedProvider: 'cache' }
    }
  }

  const result = await speak(config, text, rate, getSecret('tts'))
  audio.set(key, result.mime === 'audio/mpeg' ? 'mp3' : 'wav', result.data)
  return {
    url: `data:${result.mime};base64,${result.data.toString('base64')}`,
    usedProvider: result.usedProvider,
    fallbackReason: result.fallbackReason
  }
}

/** Pressing the hotkey while the popup is open dismisses it. */
export function toggleOrExplain(preloadPath: string): void {
  if (isPopupVisible()) {
    cancelInFlight()
    hidePopup()
    return
  }
  void explainOrPick(preloadPath)
}

export function flushCaches(): void {
  explanationCache?.flush()
}
