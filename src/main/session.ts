/**
 * Orchestrates one lookup: capture → explain → stream into the popup.
 */
import { app, screen } from 'electron'
import { join } from 'node:path'
import type { ExplainRequest, ExplainState } from '../shared/types.js'
import { captureSelection } from './capture.js'
import { readScreenRegion } from './ocr.js'
import { readTextAtPoint } from './uia.js'
import { pickRegion } from './overlay.js'
import { regionIsStillValid } from '../core/region.js'
import { assessReadability } from '../core/readable.js'
import { showPopup, updatePopup, hidePopup, isPopupVisible } from './popup.js'
import { detectMode, SectionParser } from '../core/explain.js'
import { loadConfig, saveConfig, getSecret } from '../core/config.js'
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
/** A snip takes a second or two; a second press should not start a rival one. */
let snipping = false

function cancelInFlight(): void {
  inFlight?.abort()
  inFlight = null
}

function emit(state: ExplainState, isNew: boolean): void {
  if (isNew) showPopup(state)
  else updatePopup(state)
}

/**
 * The one hotkey: explain the selection, or read the screen when there isn't one.
 *
 * Selecting text and watching a video are the same gesture from the user's side —
 * "explain this" — so they get the same key. A selection always wins; the screen
 * region is what happens when there is nothing selected, which is exactly the case
 * while a video is playing.
 */
export async function explainOrSnip(preloadPath: string): Promise<void> {
  cancelInFlight()

  const config = loadConfig()
  const displays = screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds }))
  const hasRegion = regionIsStillValid(config.snipRegion, displays)

  // 1. A selection, if there is one. Fastest and exactly what was chosen.
  //
  // Try hard for it only when nothing else can help; with something to fall back on,
  // two 700ms attempts before every lookup would make this feel sluggish.
  const selection = hasRegion ? await captureSelection(400, 1) : await captureSelection(400, 1)
  if (selection.ok) {
    await run({ mode: detectMode(selection.text), text: selection.text }, true)
    return
  }

  // 2. The text under the pointer, read from the app's own accessibility tree.
  //
  // Exact where OCR is a guess, and needs no region: point at a transcript line and
  // press the key. Most things on screen that are really text can be read this way,
  // which leaves screen reading for the cases that genuinely are not — video frames
  // and images.
  const cursor = screen.getCursorScreenPoint()
  const physical = screen.dipToScreenPoint(cursor)
  let underPointer = await readTextAtPoint(physical.x, physical.y)

  // Chromium builds its accessibility tree the first time a client asks, so the very
  // first read of a window can come back empty even though there is text there. Pay
  // for one retry only when the alternative is failing outright — with a screen
  // region set, falling straight through keeps the subtitle loop quick.
  if (!underPointer && !hasRegion) {
    underPointer = await readTextAtPoint(physical.x, physical.y)
  }

  if (underPointer) {
    await run({ mode: detectMode(underPointer), text: underPointer }, true)
    return
  }

  // 3. Read the screen. Only reached when the pixels are all there is.
  if (hasRegion) {
    await snipScreen(preloadPath)
    return
  }

  showError('Nothing to explain here. Select some text, point at some, or read the screen.', {
    id: 'read-screen',
    label: 'Read part of the screen'
  })
}

function showError(message: string, action?: ExplainState['action']): void {
  showPopup({ mode: 'passage', text: '', explanation: {}, status: 'error', error: message, action })
}

/**
 * Read a region of the screen and explain what it says.
 *
 * The remembered region is reused when it is still meaningful, which is what makes
 * this one keypress per subtitle line. Everything past the OCR call is the ordinary
 * explain path — a snip and a selection are indistinguishable from there on.
 */
export async function snipScreen(preloadPath: string, forcePick = false): Promise<void> {
  if (snipping) return
  snipping = true
  try {
    cancelInFlight()
    const config = loadConfig()

    const displays = screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds }))
    let region = config.snipRegion

    if (forcePick || !regionIsStillValid(region, displays)) {
      const picked = await pickRegion(preloadPath)
      if (!picked) return // cancelled — say nothing
      region = picked
      saveConfig({ snipRegion: picked })
      // Let the overlay finish disappearing, or it ends up in its own screenshot.
      await new Promise((r) => setTimeout(r, 150))
    }

    if (!region) return

    // Acknowledge the keypress immediately. Capture and OCR take over a second, and
    // without this the hotkey feels like it did nothing at all.
    showPopup({
      mode: 'passage',
      text: 'Reading the screen…',
      explanation: {},
      status: 'streaming'
    })

    const result = await readScreenRegion(region)
    if (!result.ok) {
      // Name the area that was read. A remembered region cannot know the video
      // moved or went full-screen, so the useful thing is to say where it looked
      // and how to point it somewhere else.
      // A remembered region cannot know the video went full-screen or the window
      // moved. Rather than make the user learn a second shortcut for that, say where
      // it looked and offer the fix as a button.
      const where = `${region.width}×${region.height} at ${region.x}, ${region.y}`
      showError(`${result.reason} Looked at a ${where} area.`, {
        id: 'pick-region',
        label: 'Pick a different area'
      })
      return
    }

    // A misread is worse than a failure: the model will explain nonsense with a
    // straight face, and it reads like a real answer. Say so instead.
    if (!assessReadability(result.text).readable) {
      showError(
        `That area did not read as text — "${result.text.slice(0, 40)}". ` +
          'It is probably pointing somewhere other than the words you want.',
        { id: 'pick-region', label: 'Pick a different area' }
      )
      return
    }

    await run({ mode: detectMode(result.text), text: result.text }, false)
  } finally {
    snipping = false
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
  void explainOrSnip(preloadPath)
}

export function flushCaches(): void {
  explanationCache?.flush()
}
