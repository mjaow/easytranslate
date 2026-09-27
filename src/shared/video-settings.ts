import type { AppConfig, VideoReasoningEffort } from './types.js'

/** Deployment names are user-defined, so never infer capabilities from the name. */
export function videoReasoningEffort(llm: AppConfig['llm']): VideoReasoningEffort {
  const effort = llm.videoReasoningEffort
  return effort === 'none' || effort === 'medium' || effort === 'high' ? effort : 'low'
}

/** Keep old standard-provider bindings valid, but separate Azure authentication. */
export function videoKeyScope(llm: AppConfig['llm']): string {
  const protocol = llm.videoProtocol === 'azure-responses' ? 'azure-responses|' : ''
  return `${protocol}${llm.videoProvider}|${llm.videoBaseUrl ?? ''}`
}
