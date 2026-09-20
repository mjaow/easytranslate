import Anthropic from '@anthropic-ai/sdk'
import type { ExplainRequest } from '../../shared/types.js'
import { systemPrompt, userPrompt } from '../../core/explain.js'
import { ProviderError, type LlmProvider, type ProviderOptions } from './types.js'

/** A dictionary entry is short; this is ample and keeps latency down. */
const MAX_TOKENS = 1024

export class ClaudeProvider implements LlmProvider {
  readonly id = 'claude' as const
  readonly label = 'Claude'
  private readonly client: Anthropic

  constructor(private readonly opts: ProviderOptions) {
    if (!opts.apiKey) {
      throw new ProviderError('No Anthropic API key set.', 'Add one in Settings.')
    }
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseUrl })
  }

  async *explain(req: ExplainRequest, signal: AbortSignal): AsyncIterable<string> {
    const stream = this.client.messages.stream(
      {
        model: this.opts.model,
        max_tokens: MAX_TOKENS,
        system: systemPrompt(req.mode),
        // Thinking is on by default on Opus 5. Low effort is the supported way to
        // keep a popup lookup snappy — disabling thinking outright is documented to
        // cause tag leakage and stray tool-call text.
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: userPrompt(req) }]
      },
      { signal }
    )

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text
      }
    }

    // A policy decline arrives as HTTP 200 with stop_reason 'refusal', so it has to
    // be checked explicitly rather than caught.
    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') {
      throw new ProviderError('Claude declined to explain this text.')
    }
  }
}

/** Turn SDK errors into something worth showing in a 300px popup. */
export function describeClaudeError(err: unknown): ProviderError {
  if (err instanceof Anthropic.AuthenticationError) {
    return new ProviderError('Anthropic rejected the API key.', 'Check it in Settings.')
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ProviderError('Rate limited by Anthropic.', 'Try again in a moment.')
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError('Could not reach Anthropic.', 'Check your connection.')
  }
  if (err instanceof Anthropic.APIError) {
    return new ProviderError(`Anthropic error ${err.status}.`, err.message)
  }
  return new ProviderError(err instanceof Error ? err.message : String(err))
}
