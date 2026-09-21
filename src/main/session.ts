/**
 * Orchestrates one lookup: capture → explain → stream into the popup.
 */
import { app, BrowserWindow, screen } from 'electron'
import { appendFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CaptureFailure, ExplainRequest, ExplainState } from '../shared/types.js'
import { captureSelection } from './capture.js'
import { readTranscriptAtPoint, readCaptionFromVideo } from './uia.js'
import { foregroundWindowTitle } from './win32.js'
import { showPopup, updatePopup, hidePopup, isPopupVisible } from './popup.js'
import { detectMode, SectionParser } from '../core/explain.js'
import { loadConfig, getSecret } from '../core/config.js'
import { JsonLruCache, AudioCache, cacheKey } from '../core/cache.js'
import { createLlmProvider, describeError } from '../providers/llm/registry.js'
import { speak } from '../providers/tts/registry.js'
import type { Explanation } from '../shared/types.js'

const CAPTURE_MESSAGES: Record<CaptureFailure, string> = {
  // The most common real cause is an elevated target window: Windows silently drops
  // synthetic input sent to a higher-integrity process (UIPI), so we say so rather
  // than failing mutely.
  'no-response':
    "Couldn't copy the selection. Try pressing Ctrl+C yourself: if that doesn't work either, " +
    'this page blocks copying. Some news sites do. (It can also mean nothing is selected, or ' +
    'that the app is running as administrator.)',
  empty: 'Nothing was selected.',
  'not-text': 'That selection is an image. Text capture only, for now.'
}

let explanationCache: JsonLruCache<Explanation> | null = null
let audioCache: AudioCache | null = null

function caches(): { explanations: JsonLruCache<Explanation>; audio: AudioCache } {
  explanationCache ??= new JsonLruCache<Explanation>(join(app.getPath('userData'), 'explanations.json'))
  audioCache ??= new AudioCache(join(app.getPath('userData'), 'audio'))
  return { explanations: explanationCache, audio: audioCache }
}

let inFlight: AbortController | null = null

function cancelInFlight(): void {
  inFlight?.abort()
  inFlight = null
}

function emit(state: ExplainState, isNew: boolean): void {
  if (isNew) showPopup(state)
  else updatePopup(state)
}

/** Hotkey handler: read the selection and explain it. */
export async function explainSelection(): Promise<void> {
  cancelInFlight()

  const result = await captureSelection()
  if (!result.ok) {
    showPopup({
      mode: 'passage',
      text: '',
      explanation: {},
      status: 'error',
      error: CAPTURE_MESSAGES[result.reason]
    })
    return
  }

  const mode = detectMode(result.text)
  await run({ mode, text: result.text }, true)
}

/**
 * Windows whose double-clicks are worth a look. A browser's title is its active
 * tab's, so this is "a YouTube or X tab is in front". X titles its pages "… / X".
 */
const VIDEO_WINDOW_TITLES = ['YouTube', '/ X']

/** One accessibility read at a time — clicks can come faster than PowerShell starts. */
let clickInFlight = false

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
 * double-click was on a line of transcript, or on a video while a caption is
 * showing — a related video, the comments, the feed all stay plain clicks. YouTube
 * puts its captions in the accessibility tree; X draws them natively, so there the
 * lower part of the picture is read with OCR. Misses on a video page are written to
 * last-click.log in the data folder, so a line that fails to register can be
 * diagnosed rather than guessed at.
 */
export async function explainClickedTranscript(click: { x: number; y: number }): Promise<void> {
  if (clickInFlight) return

  const title = foregroundWindowTitle()
  if (!VIDEO_WINDOW_TITLES.some((t) => title.includes(t))) return
  if (isOverOwnWindow(screen.screenToDipPoint(click))) return

  clickInFlight = true
  try {
    const { text, read } = await readTranscriptAtPoint(click.x, click.y)

    if (!text && read?.video) {
      // Acknowledge at once: capture and OCR take over a second.
      showPopup({ mode: 'passage', text: 'Reading the caption…', explanation: {}, status: 'streaming' })
      const display = screen.getDisplayNearestPoint(screen.screenToDipPoint(click))
      const frame = screen.dipToScreenRect(null, display.bounds)
      const caption = await readCaptionFromVideo(click, read.video, frame)
      // Logged whether or not it worked: when the wrong text comes back, the answer
      // is in which lines OCR saw and which one was chosen.
      void logMiss(
        [
          `${new Date().toISOString()}  ${title}`,
          `video double-click at ${click.x},${click.y}`,
          `tree video rect: ${read.video.x},${read.video.y} ${read.video.width}x${read.video.height}`,
          `read band: ${caption.band.x},${caption.band.y} ${caption.band.width}x${caption.band.height}`,
          ...caption.lines.map((l) => `  ocr: ${l}`),
          `chosen: ${caption.text ?? '-'}`,
          '',
          ''
        ].join('\n')
      )
      if (caption.text) {
        cancelInFlight()
        await run({ mode: detectMode(caption.text), text: caption.text }, false)
        return
      }
      showPopup({
        mode: 'passage',
        text: '',
        explanation: {},
        status: 'error',
        error: 'No caption could be read off the video. Are captions on? Try again while a line is showing.'
      })
    }

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
export function toggleOrExplain(): void {
  if (isPopupVisible()) {
    cancelInFlight()
    hidePopup()
    return
  }
  void explainSelection()
}

export function flushCaches(): void {
  explanationCache?.flush()
}
