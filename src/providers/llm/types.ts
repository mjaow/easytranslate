import type { ExplainRequest, LlmProviderId } from '../../shared/types.js'

export interface LlmProvider {
  readonly id: LlmProviderId
  readonly label: string
  /** Yields text fragments as they arrive. Throws with a user-readable message. */
  explain(req: ExplainRequest, signal: AbortSignal): AsyncIterable<string>
}

export interface ProviderOptions {
  apiKey: string | null
  model: string
  baseUrl?: string
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
