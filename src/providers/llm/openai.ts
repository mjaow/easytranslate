import OpenAI from 'openai'
import type { ExplainRequest } from '../../shared/types.js'
import { systemPrompt, userPrompt } from '../../core/explain.js'
import { ProviderError, type GenerationRequest, type LlmProvider, type ProviderOptions } from './types.js'

const MAX_TOKENS = 1024

export class OpenAiProvider implements LlmProvider {
  readonly id = 'openai' as const
  readonly label = 'OpenAI'
  private readonly client: OpenAI

  constructor(private readonly opts: ProviderOptions) {
    if (!opts.apiKey) {
      throw new ProviderError('No API key set for this model provider.', 'Add one in Settings.')
    }
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseUrl })
  }

  async ping(signal: AbortSignal): Promise<void> {
    const officialOpenAi = new URL(this.opts.baseUrl || 'https://api.openai.com/v1').hostname === 'api.openai.com'
    await this.client.chat.completions.create(
      { model: this.opts.model, ...(officialOpenAi ? { max_completion_tokens: 1 } : { max_tokens: 1 }), messages: [{ role: 'user', content: 'hi' }] },
      { signal }
    )
  }

  async *explain(req: ExplainRequest, signal: AbortSignal): AsyncIterable<string> {
    yield* this.generate({ system: systemPrompt(req.mode), user: userPrompt(req), maxTokens: MAX_TOKENS }, signal)
  }

  async *generate(req: GenerationRequest, signal: AbortSignal): AsyncIterable<string> {
    const officialOpenAi = new URL(this.opts.baseUrl || 'https://api.openai.com/v1').hostname === 'api.openai.com'
    const gemini = new URL(this.opts.baseUrl || 'https://api.openai.com/v1').hostname === 'generativelanguage.googleapis.com'
    const stream = await this.client.chat.completions.create(
      {
        model: this.opts.model,
        ...(officialOpenAi ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }),
        // The video workflow verifies each section separately. Avoid Gemini's
        // default thinking budget turning an inexpensive read into a long wait.
        ...(req.json && gemini && this.opts.model.startsWith('gemini-3') ? { reasoning_effort: 'low' as const } : {}),
        ...(req.json ? { response_format: { type: 'json_object' as const } } : {}),
        stream: true,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user }
        ]
      },
      { signal, ...(req.json ? { maxRetries: 0, timeout: 60000 } : {}) }
    )

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) yield delta
      if (chunk.choices[0]?.finish_reason === 'length') throw new ProviderError('The model stopped at its output limit. Choose a model with a larger output limit in Settings.')
      if (chunk.choices[0]?.finish_reason === 'content_filter') throw new ProviderError('The model provider declined this content. No complete analysis was generated.')
    }
  }
}

export function describeOpenAiError(err: unknown): ProviderError {
  if (err instanceof OpenAI.AuthenticationError) {
    return new ProviderError('The model provider rejected the API key.', 'Check it in Settings.')
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new ProviderError('The model provider reports a rate or quota limit.', 'Check API billing and quota, then retry.')
  }
  // The SDK also wraps transport timeouts (including connection setup) in
  // APIConnectionTimeoutError. Preserve its nested cause before the fallback:
  // a short connection timeout does not mean the model used its time budget.
  const network = describeNetworkError(err)
  if (network) return network
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return new ProviderError('The model request timed out.', 'No more specific timeout cause was reported. Retry; if it repeats, check the provider’s service status and your network or proxy.')
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new ProviderError('The connection to the model provider failed.', 'No HTTP error response was available. Retry; if it repeats, check the provider’s service status and your network or proxy.')
  }
  if (err instanceof OpenAI.APIError) {
    return new ProviderError(err.status ? `Model provider error ${err.status}.` : 'The model provider rejected the request.', err.message)
  }
  return new ProviderError(err instanceof Error ? err.message : String(err))
}

/** Fetch hides transport failures in nested causes, sometimes AggregateError.
 * Only expose known codes: raw error messages may contain URLs or credentials.
 * Also handles failures while reading a stream, which need not be SDK errors.
 */
function describeNetworkError(error: unknown): ProviderError | null {
  const pending: unknown[] = [error]
  const seen = new Set<object>()
  for (let checked = 0; pending.length && checked < 16; checked++) {
    const value = pending.shift()
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    const e = value as { code?: unknown; cause?: unknown; errors?: unknown }
    const code = typeof e.code === 'string' ? e.code : ''
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
      return new ProviderError('Could not resolve the model provider’s address.', `DNS lookup failed (${code}). Check the configured endpoint and your DNS or VPN connection.`)
    }
    if (['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)) {
      return new ProviderError('The model provider’s TLS certificate could not be verified.', `Secure connection failed (${code}). Check the endpoint and the certificates required by your network or proxy.`)
    }
    if (code === 'UND_ERR_CONNECT_TIMEOUT') {
      return new ProviderError('Timed out connecting to the model provider.', 'A connection could not be established (UND_ERR_CONNECT_TIMEOUT). This is a connection failure, not a measure of model processing time. Retry; if it repeats, check the endpoint and your network or proxy.')
    }
    if (code === 'UND_ERR_HEADERS_TIMEOUT') {
      return new ProviderError('Timed out waiting for the model provider’s response.', 'The connection opened, but no HTTP response arrived in time (UND_ERR_HEADERS_TIMEOUT). Retry; if it repeats, check the provider’s service status and your network or proxy.')
    }
    if (code === 'UND_ERR_BODY_TIMEOUT') {
      return new ProviderError('The model response stream timed out.', 'The provider began responding, then stopped sending data for too long (UND_ERR_BODY_TIMEOUT). No complete summary was received. Retry the summary.')
    }
    if (code === 'ETIMEDOUT') {
      return new ProviderError('The model connection timed out.', `The network request exceeded its deadline (${code}). Retry; if it repeats, check the provider’s service status and your network or proxy.`)
    }
    if (['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(code)) {
      return new ProviderError('The connection to the model provider was interrupted.', `The connection closed before the request finished (${code}). Retry the summary.`)
    }
    if (code === 'ECONNREFUSED') {
      return new ProviderError('The connection to the model provider was refused.', 'The server refused the connection (ECONNREFUSED). Check the endpoint and whether the service is running.')
    }
    pending.push(e.cause)
    if (Array.isArray(e.errors)) pending.push(...e.errors.slice(0, 8))
  }
  return null
}
