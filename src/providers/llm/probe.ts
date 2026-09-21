/**
 * Connection test: does this key actually work with this model, right now?
 *
 * It sends the smallest real request the provider accepts, through the same client
 * a lookup uses. An earlier version only listed models and checked the configured id
 * appeared — which passed while every real lookup returned 403, because a listing is
 * a *catalogue*, not a statement of what your account may call. Alibaba, Google and
 * OpenAI all list models you must separately activate or be granted access to.
 *
 * Only when that real call fails do we fetch the listing, to suggest alternatives.
 */
import type { AppConfig } from '../../shared/types.js'
import { createLlmProvider, describeError } from './registry.js'

export interface ProbeResult {
  ok: boolean
  message: string
  /** Suggestions, only gathered when the real call failed on the model. */
  models?: string[]
  /** True when the key works but this model can't be used. */
  modelMissing?: boolean
}

const TIMEOUT_MS = 20000

/**
 * Test the everyday model and, when one is set, the code model too. Either failing
 * fails the test: a wrong id in the code field would otherwise surface only on the
 * first click of the "explain this code" button.
 */
export async function probeConfigured(config: AppConfig, apiKey: string | null): Promise<ProbeResult> {
  const everyday = await probeProvider(config, apiKey)
  const codeModel = config.llm.codeModel.trim()
  if (!codeModel || !everyday.ok) return everyday

  const code = await probeProvider(config, apiKey, codeModel)
  return code.ok
    ? { ok: true, message: `${everyday.message} Code explanations: "${codeModel}" answered too.` }
    : { ...code, message: `${everyday.message} But the code model failed: ${code.message}` }
}

export async function probeProvider(
  config: AppConfig,
  apiKey: string | null,
  model = config.llm.models[config.llm.provider] ?? ''
): Promise<ProbeResult> {
  const providerId = config.llm.provider

  let provider
  try {
    provider = createLlmProvider(config, apiKey, model)
  } catch (err) {
    const e = describeError(providerId, err)
    return { ok: false, message: [e.message, e.hint].filter(Boolean).join(' ') }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    await provider.ping(controller.signal)
    return { ok: true, message: `Working. "${model}" answered a real request.` }
  } catch (err) {
    const status = statusOf(err)
    const e = describeError(providerId, err)
    const detail = [e.message, e.hint].filter(Boolean).join(' ')

    // 403/404 on a request that carried a model id is nearly always the model, not
    // the key — so offer what else this endpoint will serve.
    if (status === 403 || status === 404) {
      const models = await listModels(config, apiKey)
      return {
        ok: false,
        modelMissing: models.length > 0,
        models,
        message:
          status === 403
            ? `"${model}" was refused (403). The key is valid but not entitled to this model — ` +
              `many providers require activating a model in their console first. It can also mean ` +
              `the key belongs to a different region than the base URL.`
            : `"${model}" was not found (404). Check the model id and the base URL.`
      }
    }
    return { ok: false, message: detail }
  } finally {
    clearTimeout(timer)
  }
}

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status
  return typeof s === 'number' ? s : undefined
}

/** Best-effort catalogue, purely to suggest alternatives after a failure. */
async function listModels(config: AppConfig, apiKey: string | null): Promise<string[]> {
  const provider = config.llm.provider
  const base = (config.llm.baseUrls[provider] ?? '').replace(/\/$/, '')

  const { url, headers } =
    provider === 'claude'
      ? {
          url: `${base}/v1/models`,
          headers: { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' }
        }
      : provider === 'ollama'
        ? { url: `${base}/api/tags`, headers: {} }
        : { url: `${base}/models`, headers: { Authorization: `Bearer ${apiKey ?? ''}` } }

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return []
    return extractModelIds(await res.json())
  } catch {
    return []
  }
}

/** Pull model ids out of the several shapes these endpoints return. */
function extractModelIds(body: unknown): string[] {
  const b = body as { data?: unknown[]; models?: unknown[] }
  const rows = Array.isArray(b?.data) ? b.data : Array.isArray(b?.models) ? b.models : []
  return rows
    .map((row) => {
      const r = row as { id?: unknown; name?: unknown }
      // Gemini reports "models/gemini-3.1-flash-lite"; strip the prefix so the id
      // matches what actually goes in the model field.
      const id = typeof r?.id === 'string' ? r.id : typeof r?.name === 'string' ? r.name : ''
      return id.startsWith('models/') ? id.slice(7) : id
    })
    .filter(Boolean)
    .sort()
}
