import type { ExplainRequest } from '../../shared/types.js'
import { systemPrompt, userPrompt } from '../../core/explain.js'
import { ProviderError, type LlmProvider, type ProviderOptions } from './types.js'

/**
 * Local models via Ollama. No SDK — Ollama's chat endpoint streams newline-delimited
 * JSON, which is a few lines to read directly.
 */
export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama' as const
  readonly label = 'Ollama (local)'

  constructor(private readonly opts: ProviderOptions) {}

  async *explain(req: ExplainRequest, signal: AbortSignal): AsyncIterable<string> {
    const base = (this.opts.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '')

    let res: Response
    try {
      res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.opts.model,
          stream: true,
          messages: [
            { role: 'system', content: systemPrompt(req.mode) },
            { role: 'user', content: userPrompt(req) }
          ]
        })
      })
    } catch {
      throw new ProviderError('Could not reach Ollama.', `Is it running at ${base}?`)
    }

    if (!res.ok) {
      throw new ProviderError(
        `Ollama returned ${res.status}.`,
        res.status === 404 ? `Model "${this.opts.model}" may not be pulled yet.` : undefined
      )
    }
    if (!res.body) throw new ProviderError('Ollama sent an empty response.')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Lines can split across reads, so only parse up to the last newline.
      let nl = buffer.indexOf('\n')
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')
        if (!line) continue
        try {
          const msg = JSON.parse(line) as { message?: { content?: string }; error?: string }
          if (msg.error) throw new ProviderError(msg.error)
          const content = msg.message?.content
          if (content) yield content
        } catch (err) {
          if (err instanceof ProviderError) throw err
          // A malformed line isn't worth aborting a nearly-complete answer over.
        }
      }
    }
  }
}
