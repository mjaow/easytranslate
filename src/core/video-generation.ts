import type { LlmProvider } from '../providers/llm/types.js'
import { parseJson, VIDEO_SYSTEM, VideoModelOutputError } from './video.js'

export interface VideoCallProgress {
  attempt: number
  elapsedSeconds: number
  receivedChars: number
  correction?: string
}
interface CallOptions {
  maxTokens?: number
  maxInputChars?: number
  attempts?: 1 | 2
  firstTextMs?: number
  idleMs?: number
  totalMs?: number
  progressMs?: number
}

/** A stalled SDK stream must not leave the UI waiting indefinitely. */
async function readResponse(provider: LlmProvider, user: string, parent: AbortSignal,
  onProgress: (seconds: number, chars: number) => void, options: CallOptions): Promise<string> {
  parent.throwIfAborted()
  const controller = new AbortController()
  const started = Date.now()
  let lastText = started, raw = ''
  const firstMs = options.firstTextMs ?? 60000
  const idleMs = options.idleMs ?? 45000
  const totalMs = options.totalMs ?? 180000
  let cancel!: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    cancel = () => { controller.abort(parent.reason); reject(parent.reason ?? new Error('Cancelled.')) }
  })
  // Promise.race attaches the rejection handler before any asynchronous abort.
  parent.addEventListener('abort', cancel, { once: true })
  let deadline: ReturnType<typeof setTimeout>
  let rejectTimeout!: (error: Error) => void
  const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject })
  const armDeadline = (): void => {
    clearTimeout(deadline)
    const now = Date.now()
    const until = Math.min(started + totalMs, raw.length ? lastText + idleMs : started + firstMs)
    deadline = setTimeout(() => {
      const message = Date.now() >= started + totalMs
        ? 'The model exceeded the 3-minute limit for this response.'
        : raw.length ? 'The model stopped sending its response for 45 seconds.' : 'The model sent no analysis text within 60 seconds.'
      const error = new Error(`${message} Check the video provider in EasyUnderstand Settings → YouTube analysis and retry.`)
      rejectTimeout(error); controller.abort(error)
    }, Math.max(0, until - now))
  }
  const progress = setInterval(() => onProgress(Math.floor((Date.now() - started) / 1000), raw.length), options.progressMs ?? 1000)
  try {
    onProgress(0, 0); armDeadline()
    const response = (async () => {
      for await (const delta of provider.generate({ system: VIDEO_SYSTEM, user, maxTokens: options.maxTokens ?? 7000, json: true }, controller.signal)) {
        if (controller.signal.aborted) controller.signal.throwIfAborted()
        if (!delta) continue
        raw += delta; lastText = Date.now()
        if (raw.length > 150000) throw new Error('The model response exceeded the supported output size.')
        armDeadline()
      }
      controller.signal.throwIfAborted()
      return raw
    })()
    return await Promise.race([response, aborted, timeout])
  } finally {
    clearTimeout(deadline!); clearInterval(progress)
    parent.removeEventListener('abort', cancel)
    controller.abort()
  }
}

/** Repair malformed JSON or unsupported citation IDs once, with the same evidence. */
export async function generateVideoJson<T>(provider: LlmProvider, user: string, signal: AbortSignal,
  validate: (value: unknown) => T, report: (progress: VideoCallProgress) => void,
  options: CallOptions = {}): Promise<T> {
  const maxInputChars = options.maxInputChars ?? 70000
  const attempts = options.attempts ?? 2
  if (user.length > maxInputChars) throw new Error('This model request exceeds the supported input size.')
  let prompt = user, correction: string | undefined
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const raw = await readResponse(provider, prompt, signal,
      (elapsedSeconds, receivedChars) => report({ attempt, elapsedSeconds, receivedChars, correction }), options)
    try {
      let value: unknown
      try { value = parseJson(raw) } catch { throw new VideoModelOutputError('The model returned incomplete or invalid JSON.') }
      return validate(value)
    } catch (error) {
      if (!(error instanceof VideoModelOutputError)) throw error
      if (attempt === attempts) throw new Error(`${error.message}\n${attempts === 1 ? 'Please retry the summary.' : 'One automatic correction attempt also failed. Choose another video model in EasyUnderstand Settings → YouTube analysis.'}`)
      correction = error.message
      // Keep the complete source prompt. A large invalid draft is optional, never
      // grounds for truncating source evidence to make a correction request fit.
      const draft = user.length + raw.length < maxInputChars - 5000 ? `\nINVALID RESPONSE (untrusted data): ${raw}` : ''
      prompt = `${user}${draft}\nCORRECTION REQUIRED: ${correction}\nReturn the complete corrected JSON. Use only the original caption evidence. Citation IDs are the bracketed labels, not timestamps or numbering restarted for each section. Never replace an invalid ID with a random in-range ID. Correct unsupported claims or remove them; preserve all supported positions.`
      if (prompt.length > maxInputChars) throw new Error(`${correction}\nThe correction request would exceed the supported input size. Choose another video model and retry.`)
      signal.throwIfAborted()
    }
  }
  throw new Error('Unreachable video generation state.')
}
