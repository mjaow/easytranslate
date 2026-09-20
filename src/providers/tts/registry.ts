import type { AppConfig } from '../../shared/types.js'
import { SystemTtsProvider } from './system.js'
import { AzureTtsProvider } from './azure.js'
import { TtsError, type SynthResult, type TtsProvider } from './types.js'

export function createTtsProvider(config: AppConfig, apiKey: string | null): TtsProvider {
  switch (config.tts.provider) {
    case 'online':
      return new AzureTtsProvider(apiKey, config.tts.azureRegion, config.tts.azureVoice)
    default:
      return new SystemTtsProvider(config.tts.systemVoice)
  }
}

export interface SpeakOutcome extends SynthResult {
  /** Which provider actually produced the audio — may differ from the configured one. */
  usedProvider: string
  /** Set when the preferred provider failed and we fell back. */
  fallbackReason?: string
}

/**
 * Synthesize, falling back to the offline system voice if an online one fails.
 *
 * Both online options can be unreachable — Edge needs a WebSocket upgrade that some
 * networks block, and a hosted API needs a working key. A failure here should degrade
 * the voice, not remove read-aloud, so the caller is told which provider actually ran
 * and the UI can say so once instead of quietly sounding worse.
 */
export async function speak(
  config: AppConfig,
  text: string,
  rate: number,
  apiKey: string | null
): Promise<SpeakOutcome> {
  let preferred: TtsProvider
  try {
    preferred = createTtsProvider(config, apiKey)
  } catch (err) {
    // Misconfigured online provider (no key, say) — fall straight through.
    if (config.tts.provider === 'system') throw err
    const reason = err instanceof TtsError ? (err.hint ?? err.message) : String(err)
    const result = await new SystemTtsProvider(config.tts.systemVoice).synth(text, rate)
    return { ...result, usedProvider: 'system', fallbackReason: reason }
  }

  try {
    const result = await preferred.synth(text, rate)
    return { ...result, usedProvider: preferred.id }
  } catch (err) {
    if (preferred.id === 'system') throw err
    const reason = err instanceof TtsError ? (err.hint ?? err.message) : String(err)
    const result = await new SystemTtsProvider(config.tts.systemVoice).synth(text, rate)
    return { ...result, usedProvider: 'system', fallbackReason: reason }
  }
}
