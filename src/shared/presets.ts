/**
 * Ready-made endpoint presets.
 *
 * Groq, Gemini, OpenRouter and friends all speak the OpenAI chat-completions
 * protocol, so the existing `openai` provider reaches every one of them — only the
 * base URL and model change. That's the pluggable design paying for itself: free and
 * near-free backends cost no extra code.
 *
 * Model IDs and prices churn fast — `gemini-2.5-flash-lite` retires 2026-10-16, for
 * instance. Prices below were checked 2026-09-19 and are per million tokens. The
 * Model field in Settings accepts anything, so a stale preset is never a dead end.
 */
import type { LlmProviderId, VideoProtocol, VideoReasoningEffort } from './types.js'

export interface EndpointPreset {
  id: string
  label: string
  provider: LlmProviderId
  baseUrl: string
  model: string
  /** Shown under the picker — what this costs and how it behaves. */
  note: string
  keyUrl?: string
}

export interface VideoEndpointPreset extends EndpointPreset {
  protocol?: VideoProtocol
  reasoningEffort?: VideoReasoningEffort
}

export const ENDPOINT_PRESETS: EndpointPreset[] = [
  {
    id: 'azure-luna',
    label: 'Azure OpenAI — GPT-6 Luna',
    provider: 'azure',
    baseUrl: 'https://YOUR-RESOURCE-NAME.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview',
    model: 'gpt-6-luna',
    note: 'Uses your Azure deployment for translation and explanations, with reasoning set to none for speed. Enter the full Responses endpoint and deployment name. Code explanations use this provider and key too; video settings remain separate.',
    keyUrl: 'https://ai.azure.com/'
  },
  {
    id: 'qwen-flash',
    label: 'Qwen Flash — cheapest, best Chinese',
    provider: 'openai',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-flash',
    // `qwen-flash` is DashScope's stable alias for the current Flash model, so it
    // follows new releases on its own. Versioned ids like `qwen3.7-flash` are what
    // other hosts (OpenRouter) use and are rejected here — use Test connection to
    // see the exact ids a key can call.
    note: "A few cents a month. Alibaba's own model, so its Chinese is the most idiomatic of the cheap options. Your key is bound to the region it was created in: this is the international endpoint, so swap in dashscope.aliyuncs.com if you registered in mainland China — that endpoint is also substantially cheaper. New accounts get a free token allowance before any billing starts.",
    keyUrl: 'https://modelstudio.console.alibabacloud.com/'
  },
  {
    id: 'groq-free',
    label: 'Groq — free, fastest',
    provider: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    note: 'Free tier, no card: ~30 requests/min, ~1000/day. Purpose-built inference hardware, so replies land in well under a second. Llama is the weakest of these at Chinese — if the translations read flat, try a Qwen model, which handles Chinese far better.',
    keyUrl: 'https://console.groq.com/keys'
  },
  {
    id: 'gemini-free',
    label: 'Gemini Flash-Lite — free tier, good Chinese',
    provider: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.1-flash-lite',
    note: 'Free tier at reduced quota (~5-15 req/min, ~1000/day), or about $0.0003 a lookup if you exceed it. Noticeably better Chinese than the Llama models, still fast.',
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  {
    id: 'claude-haiku',
    label: 'Claude Haiku 4.5 — best value',
    provider: 'claude',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-4-5',
    note: 'About $0.0009 a lookup — roughly $3/month at 100 lookups a day. Idiomatic Chinese, and follows the section format consistently.',
    keyUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'claude-sonnet',
    label: 'Claude Sonnet 5 — sharper nuance',
    provider: 'claude',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-5',
    note: 'About $0.0018 a lookup, ~$5/month at 100 a day. Better on slang, tone and register than Haiku. Worth it if the texts you read are idiom-heavy.',
    keyUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'openai-nano',
    label: 'OpenAI nano — cheapest paid',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5-nano',
    note: 'About $0.00006 a lookup — pennies per month even with heavy use. Fast and very cheap, but less reliable on subtle Chinese wording.',
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'ollama-local',
    label: 'Ollama — free forever, offline, private',
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'qwen2.5:3b',
    note: 'No key, no network, no cost ever. Measured ~11s per lookup on a CPU-only machine. Choose it for privacy or offline use, not for speed. Pronunciations also work offline from the bundled dictionary. Qwen handles Chinese far better than Llama or Mistral.'
  }
]

/** Video choices are independent of the short-lookup presets above. Checked 2026-09-26. */
export const VIDEO_PRESETS: VideoEndpointPreset[] = [
  {
    id: 'video-gemini-flash', label: 'Gemini 3.8 Flash — recommended starting point',
    provider: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
    note: 'Start here for detailed interviews. Paid API: $0.75 input / $3.75 output per million tokens through Dec 31, 2026; $1.50 / $7.50 afterward. Thinking counts as output. Free-tier quotas may limit long videos. Quality and latency still need testing on your videos.',
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  {
    id: 'video-azure-luna', label: 'Azure OpenAI — GPT-6 Luna · faster summaries',
    provider: 'openai', protocol: 'azure-responses', reasoningEffort: 'none',
    baseUrl: 'https://YOUR-RESOURCE-NAME.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview',
    model: 'gpt-6-luna',
    note: 'A lower-cost candidate for full-transcript summaries, with reasoning set to none for speed. Requires a GPT-6 Luna deployment in your Azure resource; enter its deployment name below. Compare accuracy and model time on your videos. A sub-10-second result is not guaranteed; Azure pricing and availability vary.',
    keyUrl: 'https://ai.azure.com/'
  },
  {
    id: 'video-azure-astra', label: 'Azure OpenAI — GPT-6 Astra',
    provider: 'openai', protocol: 'azure-responses',
    reasoningEffort: 'low',
    baseUrl: 'https://YOUR-RESOURCE-NAME.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview',
    model: 'gpt-6-astra',
    note: 'Uses your Azure deployment through the Responses API. Paste the full Responses endpoint, including api-version, and save the resource’s API key below. Low reasoning effort limits latency and token use; charges follow your Azure deployment pricing.',
    keyUrl: 'https://ai.azure.com/'
  },
  {
    id: 'video-openai-luna', label: 'GPT-6 Luna — lowest API cost',
    provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna',
    note: 'Standard API: $0.10 input / $0.50 output per million tokens at this app’s request sizes. An inexpensive candidate; compare its handling of nuance with Gemini on the same videos.',
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'video-claude-sonnet', label: 'Claude Sonnet 5 — alternative to compare',
    provider: 'claude', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5',
    note: 'Standard API: $2 input / $10 output per million tokens. A more expensive alternative for detailed analysis; no comparative quality benchmark has been run in this app.',
    keyUrl: 'https://console.anthropic.com/settings/keys'
  },
  ...ENDPOINT_PRESETS.filter(p => p.id === 'ollama-local')
]

export const DEFAULT_VIDEO_PRESET = VIDEO_PRESETS[0]
