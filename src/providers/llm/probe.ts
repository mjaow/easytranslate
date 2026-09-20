/**
 * Connection test: does this key work, and does this endpoint actually serve the
 * model we're asking for?
 *
 * Model ids drift constantly and differ between hosts — the same Qwen model is
 * `qwen3.7-flash` on one endpoint and `qwen/qwen3.7-flash` on another. When it's
 * wrong you get an opaque 403 or 404 with no hint at the right spelling, which is
 * unguessable. Asking the endpoint what it serves turns that into a list to pick from.
 */
import type { AppConfig } from '../../shared/types.js'

export interface ProbeResult {
  ok: boolean
  message: string
  /** Model ids the endpoint reports, when it offers a listing. */
  models?: string[]
  /** True when the key works but the configured model isn't in the list. */
  modelMissing?: boolean
}

const TIMEOUT_MS = 15000

export async function probeProvider(config: AppConfig, apiKey: string | null): Promise<ProbeResult> {
  const provider = config.llm.provider
  const model = config.llm.models[provider] ?? ''
  const base = (config.llm.baseUrls[provider] ?? '').replace(/\/$/, '')

  if (provider !== 'ollama' && !apiKey) {
    return { ok: false, message: 'No API key saved for this provider.' }
  }

  const { url, headers } = request(provider, base, apiKey)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, { headers, signal: controller.signal })

    if (!res.ok) {
      return { ok: false, message: explainStatus(res.status, await safeBody(res)) }
    }

    const models = extractModelIds(await res.json())

    // Some endpoints don't offer a listing. A 200 still proves the key works.
    if (models.length === 0) {
      return { ok: true, message: 'The key works. This endpoint does not list its models.' }
    }

    if (model && !models.includes(model)) {
      return {
        ok: false,
        modelMissing: true,
        models,
        message: `The key works, but "${model}" is not among the ${models.length} models it can use.`
      }
    }

    return { ok: true, models, message: `Connected. "${model}" is available.` }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, message: 'The endpoint did not respond in time.' }
    }
    return { ok: false, message: `Could not reach ${base || 'the endpoint'}.` }
  } finally {
    clearTimeout(timer)
  }
}

function request(
  provider: string,
  base: string,
  apiKey: string | null
): { url: string; headers: Record<string, string> } {
  if (provider === 'claude') {
    return {
      url: `${base}/v1/models`,
      headers: { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' }
    }
  }
  if (provider === 'ollama') {
    // Ollama's own listing endpoint; it has no /models under the OpenAI shim.
    return { url: `${base}/api/tags`, headers: {} }
  }
  // Everything OpenAI-compatible: OpenAI, Gemini, Groq, Qwen, OpenRouter, ...
  return { url: `${base}/models`, headers: { Authorization: `Bearer ${apiKey ?? ''}` } }
}

/** Pull model ids out of the several shapes these endpoints return. */
function extractModelIds(body: unknown): string[] {
  const b = body as { data?: unknown[]; models?: unknown[] }
  const rows = Array.isArray(b?.data) ? b.data : Array.isArray(b?.models) ? b.models : []
  return rows
    .map((row) => {
      const r = row as { id?: unknown; name?: unknown }
      // Gemini reports "models/gemini-3.1-flash-lite"; strip the prefix so the id
      // matches what you actually put in the model field.
      const id = typeof r?.id === 'string' ? r.id : typeof r?.name === 'string' ? r.name : ''
      return id.startsWith('models/') ? id.slice(7) : id
    })
    .filter(Boolean)
    .sort()
}

async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return ''
  }
}

function explainStatus(status: number, body: string): string {
  const detail = body ? ` — ${body.replace(/\s+/g, ' ').trim()}` : ''
  switch (status) {
    case 401:
      return `The API key was rejected (401).${detail}`
    case 403:
      // The common causes, in the order they actually happen.
      return (
        `Access denied (403). The key is probably valid but not entitled to this model, ` +
        `or it belongs to a different region than the base URL.${detail}`
      )
    case 404:
      return `Not found (404). The base URL is likely wrong for this provider.${detail}`
    case 429:
      return `Rate limited (429). Try again shortly.${detail}`
    default:
      return `The endpoint returned ${status}.${detail}`
  }
}
