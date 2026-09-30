import type { ExplainRequest, LlmProviderId } from '../../shared/types.js'

export interface LlmProvider {
  readonly id: LlmProviderId
  readonly label: string
  /** Yields text fragments as they arrive. Throws with a user-readable message. */
  explain(req: ExplainRequest, signal: AbortSignal): AsyncIterable<string>
  generate(req: GenerationRequest, signal: AbortSignal): AsyncIterable<string>
  /**
   * Smallest possible real request, to prove the key and model actually work.
   * Throws the same errors `explain` would.
   */
  ping(signal: AbortSignal): Promise<void>
}

export interface ProviderOptions {
  apiKey: string | null
  model: string
  baseUrl?: string
}

export interface GenerationRequest {
  system: string
  user: string
  maxTokens: number
  json?: boolean
}

/** Errors whose message is safe and useful to show directly in the popup. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly hint?: string
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** What a reader needs to know when the answer stopped early. */
export const CUT_SHORT = 'The answer was cut short — this selection is longer than one reply can hold.'
/** What to do about it. The same advice whichever provider ran out of room. */
export const SELECT_LESS = 'Select fewer paragraphs to get the whole answer.'

/**
 * The model ran out of output tokens part-way through.
 *
 * Its own class because this one is not like the others: everything streamed before
 * it is real and useful. Throwing a plain error here threw away a translation that
 * was three-quarters finished and showed the user nothing at all, so the caller
 * treats this as "done, but cut short" and keeps what arrived.
 *
 * A provider may word the message itself — Azure has to, because the same call serves
 * the video workflow, where a truncated JSON response is not recoverable and the
 * failure needs to be attributable.
 */
export class OutputLimitError extends ProviderError {
  constructor(message: string = CUT_SHORT, hint?: string) {
    super(message, hint)
    this.name = 'OutputLimitError'
  }
}
