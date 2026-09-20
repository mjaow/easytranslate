import OpenAI from 'openai'
import type { ExplainRequest } from '../../shared/types.js'
import { systemPrompt, userPrompt } from '../../core/explain.js'
import { ProviderError, type LlmProvider, type ProviderOptions } from './types.js'

const MAX_TOKENS = 1024

export class OpenAiProvider implements LlmProvider {
  readonly id = 'openai' as const
  readonly label = 'OpenAI'
  private readonly client: OpenAI

  constructor(private readonly opts: ProviderOptions) {
    if (!opts.apiKey) {
      throw new ProviderError('No OpenAI API key set.', 'Add one in Settings.')
    }
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseUrl })
  }

  async ping(signal: AbortSignal): Promise<void> {
    await this.client.chat.completions.create(
      { model: this.opts.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] },
      { signal }
    )
  }

  async *explain(req: ExplainRequest, signal: AbortSignal): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.opts.model,
        max_tokens: MAX_TOKENS,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt(req.mode) },
          { role: 'user', content: userPrompt(req) }
        ]
      },
      { signal }
    )

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) yield delta
    }
  }
}

export function describeOpenAiError(err: unknown): ProviderError {
  if (err instanceof OpenAI.AuthenticationError) {
    return new ProviderError('OpenAI rejected the API key.', 'Check it in Settings.')
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new ProviderError('Rate limited by OpenAI.', 'Try again in a moment.')
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new ProviderError('Could not reach OpenAI.', 'Check your connection.')
  }
  if (err instanceof OpenAI.APIError) {
    return new ProviderError(`OpenAI error ${err.status}.`, err.message)
  }
  return new ProviderError(err instanceof Error ? err.message : String(err))
}
