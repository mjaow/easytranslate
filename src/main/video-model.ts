import type { AppConfig } from '../shared/types.js'
import { getSecret } from '../core/config.js'
import { resolveVideoConfig } from '../core/video-config.js'
import { generateVideoJson } from '../core/video-generation.js'
import { sourcesField, stringField, VideoModelOutputError } from '../core/video.js'
import { createLlmProvider, describeError } from '../providers/llm/registry.js'
import type { LlmProvider } from '../providers/llm/types.js'
import type { ProbeResult } from '../providers/llm/probe.js'
import { AzureResponsesProvider } from '../providers/llm/azure-responses.js'
import { videoKeyScope, videoReasoningEffort } from '../shared/video-settings.js'

export function createVideoProvider(saved: AppConfig): LlmProvider {
  const { config, model } = resolveVideoConfig(saved)
  const provider = config.llm.provider
  if (!model) throw new Error('Set the video model in EasyTranslate Settings → YouTube analysis.')
  if (!config.llm.videoBaseUrl?.trim()) throw new Error('Set the video API base URL in EasyTranslate Settings → YouTube analysis.')
  if (provider !== 'ollama' && !process.env.EASYTRANSLATE_VIDEO_API_KEY &&
      config.llm.videoKeyScope !== videoKeyScope(config.llm)) {
    throw new Error('Save the dedicated video API key for this endpoint in EasyTranslate Settings → YouTube analysis.')
  }
  const key = provider === 'ollama' ? null : getSecret('video')
  if (provider !== 'ollama' && !key) throw new Error('No video API key is saved. Add it in EasyTranslate Settings → YouTube analysis.')
  if (config.llm.videoProtocol === 'azure-responses') {
    if (provider !== 'openai') throw new Error('Choose the Azure OpenAI video preset before using an Azure Responses endpoint.')
    return new AzureResponsesProvider({ apiKey: key, model, baseUrl: config.llm.videoBaseUrl,
      reasoningEffort: videoReasoningEffort(config.llm) })
  }
  return createLlmProvider(config, key, model)
}

/** Exercise the same streaming JSON path and citation checks as video analysis. */
export async function testVideoModel(saved: AppConfig): Promise<ProbeResult> {
  const { config, model } = resolveVideoConfig(saved)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)
  try {
    const provider = createVideoProvider(saved)
    await generateVideoJson(provider,
      'Summarize the advice and its reason in one English sentence, using only these captions. ' +
      'Return JSON {"answer":"...","sources":[caption IDs]}. IDs are labels, not timestamps.\n' +
      'CAPTIONS:\n[101] Cold dough rises more slowly.\n[102] Judge readiness by dough expansion, rather than a fixed timer.\n[103] This recipe uses wheat flour.',
      controller.signal, value => {
        const v = value as { answer?: unknown; sources?: unknown }
        if (!v || !stringField(v.answer).trim()) throw new VideoModelOutputError('The test returned no summary.')
        const sources = sourcesField(v.sources, 101, 103)
        if (!sources.length) throw new VideoModelOutputError('The test returned no caption references.')
        return { answer: v.answer, sources }
      }, () => {}, { maxTokens: 1200 })
    return { ok: true, message: `Working. "${model}" answered a short transcript test with valid citation IDs. Review your first video to check depth and accuracy.` }
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, message: `"${model}" did not finish the test within 45 seconds. Retry or check the provider’s service status.` }
    const status = (error as { status?: number })?.status
    if (status === 401 || status === 403) return { ok: false, message: `The video provider rejected the key or access to "${model}" (${status}). Check the saved video key, API permissions, and project access.` }
    if (status === 404) return { ok: false, message: config.llm.videoProtocol === 'azure-responses'
      ? `Azure could not find "${model}" or the requested API (404). Check the deployment name, resource endpoint, and api-version.`
      : `"${model}" was not found (404). Check the video model ID and API base URL.` }
    if (status === 429) return { ok: false, message: 'The video provider reports a rate or quota limit (429). Check API billing and quota, then retry.' }
    const detail = describeError(config.llm.provider, error)
    return { ok: false, message: [detail.message, detail.hint].filter(Boolean).join(' ') }
  } finally { clearTimeout(timer) }
}
