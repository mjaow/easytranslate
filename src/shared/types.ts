/** Types shared across main, preload and renderer. Keep this dependency-free. */

// ---------------------------------------------------------------- capture

/** Why a capture attempt produced no usable text. Drives the message the popup shows. */
export type CaptureFailure =
  /** The app never responded to Ctrl+C. Usually elevated (UIPI) or has no text selection. */
  | 'no-response'
  /** The app responded but the selection was empty or whitespace only. */
  | 'empty'
  /** Clipboard held something we can't explain (an image, a file drop). */
  | 'not-text'

export type CaptureResult =
  | { ok: true; text: string; elapsedMs: number }
  | { ok: false; reason: CaptureFailure; elapsedMs: number }

// ---------------------------------------------------------------- explain

/**
 * WORD explains a single term *inside* a sentence; PASSAGE explains a whole selection.
 * Chosen automatically from selection length, or forced to WORD by a word-chip click.
 */
export type ExplainMode = 'word' | 'passage'

export interface ExplainRequest {
  mode: ExplainMode
  /** The word, or the whole passage. */
  text: string
  /** The surrounding sentence. Present (and required) when mode === 'word'. */
  context?: string
}

/**
 * Sections the model streams back, in order. The popup renders each as it fills.
 * Kept flat and optional so a half-arrived response still renders.
 */
export interface Explanation {
  /** Natural Chinese rendering. */
  zh?: string
  /** The same thing in plainer English. */
  en?: string
  /** WORD only: American IPA, e.g. /ˈɡrænˌstændɪŋ/ */
  ipa?: string
  /** WORD only: part of speech. */
  pos?: string
  /** Why it means that *here*, given the context. */
  here?: string
  /** An example sentence, EN then ZH. */
  example?: string
  /** PASSAGE only: idioms/slang worth drilling into. */
  notable?: string[]
}

export interface ExplainState {
  mode: ExplainMode
  /** The headword (WORD) or full selection (PASSAGE). */
  text: string
  context?: string
  explanation: Explanation
  status: 'streaming' | 'done' | 'error'
  error?: string
}

// ---------------------------------------------------------------- config

export type LlmProviderId = 'claude' | 'openai' | 'ollama'
export type TtsProviderId = 'online' | 'system'

/**
 * Where an API key is filed. Read-aloud gets its own slot rather than sharing the
 * LLM's: the `openai` LLM slot often holds a Gemini or Groq key, since those speak
 * the OpenAI protocol, and such a key would be rejected by OpenAI's speech API.
 */
export type SecretId = LlmProviderId | 'tts'

export interface AppConfig {
  hotkeys: {
    /** Capture the selection and explain it. The popup handles read-aloud. */
    explain: string
  }
  llm: {
    provider: LlmProviderId
    /** Per-provider model id. Keys are LlmProviderId. */
    models: Record<string, string>
    /** Base URL override, mainly for Ollama / proxies. Keys are LlmProviderId. */
    baseUrls: Record<string, string>
  }
  tts: {
    provider: TtsProviderId
    /** SAPI voice name for the offline fallback, e.g. "Microsoft Zira". Empty = auto. */
    systemVoice: string
    /** Azure Speech region, e.g. "eastus". */
    azureRegion: string
    /** Azure neural voice, e.g. "en-US-AvaMultilingualNeural". */
    azureVoice: string
    /** Percentage offset for the slow (turtle) button, e.g. -40. */
    slowRate: number
    /** Read the selection aloud automatically when the popup opens. */
    autoPlay: boolean
  }
  /** Start EasyTranslate when you log in. */
  launchAtLogin: boolean
}

// ---------------------------------------------------------------- ipc

/** Payload pushed to the popup each time its content changes. */
export interface PopupPayload {
  state: ExplainState
}

export const IPC = {
  /** main → popup: new or updated explanation state */
  popupUpdate: 'popup:update',
  /** popup → main: close me */
  popupClose: 'popup:close',
  /** popup → main: report content height so the window can size to fit */
  popupResize: 'popup:resize',
  /** popup → main: play audio for text; resolves to an mp3 data url */
  ttsSpeak: 'tts:speak',
  /** settings ↔ main */
  configGet: 'config:get',
  configSet: 'config:set',
  configSecretSet: 'config:secret-set',
  configSecretStatus: 'config:secret-status',
  /** settings → main: can this accelerator be bound right now? */
  hotkeyCheck: 'config:hotkey-check',
  /** settings → main: does the configured key and model actually work? */
  llmTest: 'config:llm-test'
} as const
