/**
 * Orchestrates one lookup: capture → explain → stream into the popup.
 */
import { app } from 'electron'
import { join } from 'node:path'
import type { CaptureFailure, ExplainRequest, ExplainState } from '../shared/types.js'
import { captureSelection } from './capture.js'
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
