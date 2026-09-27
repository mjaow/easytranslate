import type { AppConfig } from '../shared/types.js'
import { DEFAULT_VIDEO_PRESET } from '../shared/presets.js'
import { videoReasoningEffort } from '../shared/video-settings.js'

/** Upgrade the old optional model override without changing everyday settings. */
export function withVideoDefaults(llm: AppConfig['llm']): AppConfig['llm'] {
  if (llm.videoProvider) return llm
  const legacyModel = llm.videoModel?.trim()
  return {
    ...llm,
    videoProvider: legacyModel ? llm.provider : DEFAULT_VIDEO_PRESET.provider,
    videoBaseUrl: legacyModel ? llm.baseUrls[llm.provider] : DEFAULT_VIDEO_PRESET.baseUrl,
    videoModel: legacyModel || DEFAULT_VIDEO_PRESET.model
  }
}

export function resolveVideoConfig(saved: AppConfig): { config: AppConfig; model: string; endpoint: string } {
  const llm = withVideoDefaults(saved.llm)
  const provider = llm.videoProvider!
  return {
    config: { ...saved, llm: { ...llm, provider,
      baseUrls: { ...llm.baseUrls, [provider]: llm.videoBaseUrl ?? '' } } },
    model: llm.videoModel.trim(),
    endpoint: llm.videoProtocol === 'azure-responses'
      ? `azure-responses:${provider}:${llm.videoBaseUrl ?? ''}|reasoning=${videoReasoningEffort(llm)}`
      : `${provider}:${llm.videoBaseUrl ?? ''}`
  }
}
