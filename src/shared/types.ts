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
  | { ok: true; text: string; raw: string; elapsedMs: number }
  | { ok: false; reason: CaptureFailure; elapsedMs: number }

// ---------------------------------------------------------------- explain

/**
 * WORD explains a single term *inside* a sentence; PASSAGE explains a whole selection.
 * Both are chosen from selection length. CODE explains a snippet of source code, and
 * is never chosen here: the model flags a selection as code in its ordinary answer,
 * the popup offers a button, and the click asks for CODE as a second step.
 */
export type ExplainMode = 'word' | 'passage' | 'code'

export interface ExplainRequest {
  mode: ExplainMode
  /** The word, or the whole passage, tidied for display and for the cache key. */
  text: string
  /**
   * The selection with its line breaks and indentation kept. This is what the model
   * sees, so a snippet of code reaches it intact rather than hard-wrap-collapsed.
   */
  raw?: string
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
  /**
   * WORD and PASSAGE: the model's own verdict on whether the selection is source
   * code. True is what makes the popup offer to explain it as code.
   */
  isCode?: boolean
  /** CODE only: the language, one word. */
  lang?: string
  /** CODE only: the problem it solves and why this approach — the understanding. */
  why?: string
  /** CODE only: what each part does, in order. */
  steps?: string[]
  /** CODE only: notable choices in how it is written, each with the reason. */
  design?: string[]
  /** CODE only: bugs, edge cases and pitfalls found in the snippet itself. */
  issues?: string[]
  /** CODE only: concepts worth learning, `term · 中文 · why it matters here`. */
  concepts?: string[]
}

export interface ExplainState {
  mode: ExplainMode
  /** The headword (WORD) or full selection (PASSAGE). */
  text: string
  /** The selection with line breaks kept — the headline for code is its first line. */
  raw?: string
  context?: string
  explanation: Explanation
  status: 'streaming' | 'done' | 'error'
  error?: string
  /** Which model produced this answer, shown in the popup so it is never a mystery. */
  model?: string
  /** True when the answer came from the cache rather than a fresh request. */
  cached?: boolean
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
  /** Double-clicking a line in a YouTube transcript explains it — no shortcut at all. */
  doubleClickTranscripts: boolean
  llm: {
    provider: LlmProviderId
    /** Per-provider model id. Keys are LlmProviderId. */
    models: Record<string, string>
    /** Base URL override, mainly for Ollama / proxies. Keys are LlmProviderId. */
    baseUrls: Record<string, string>
    /**
     * Model for code explanations, on the same provider and key. Empty means the
     * ordinary model. Reasoning about design and bugs is where a stronger model pays
     * off, and it is paid only when the user clicks for it.
     */
    codeModel: string
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
  /** main → popup: silence any playback (the popup is going away) */
  popupStop: 'popup:stop-audio',
  /** popup → main: close me */
  popupClose: 'popup:close',
  /** popup → main: explain the current selection as code */
  popupExplainCode: 'popup:explain-code',
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
