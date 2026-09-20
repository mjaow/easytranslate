import { describe, it, expect } from 'vitest'
import { AzureTtsProvider } from '../src/providers/tts/azure.js'
import { TtsError } from '../src/providers/tts/types.js'

describe('AzureTtsProvider', () => {
  it('refuses to construct without a key or region', () => {
    expect(() => new AzureTtsProvider(null, 'eastus', 'v')).toThrow(TtsError)
    expect(() => new AzureTtsProvider('k', '', 'v')).toThrow(TtsError)
  })

  it('escapes selected text so a page cannot inject SSML', async () => {
    // The selection comes from arbitrary web pages. Without escaping, text like
    // this would either break the XML or smuggle in its own markup.
    let sentBody = ''
    const original = globalThis.fetch
    globalThis.fetch = (async (_u: unknown, init: { body?: string }) => {
      sentBody = init.body ?? ''
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }
    }) as unknown as typeof fetch

    try {
      const p = new AzureTtsProvider('key', 'eastus', 'en-US-AvaMultilingualNeural')
      await p.synth(`Tom & Jerry <voice name='evil'>pwned</voice> "quoted"`, 0)
    } finally {
      globalThis.fetch = original
    }

    expect(sentBody).toContain('Tom &amp; Jerry')
    expect(sentBody).toContain('&lt;voice')
    // Exactly one real <voice> element — the injected one must not have survived.
    expect(sentBody.match(/<voice /g)).toHaveLength(1)
  })

  it('wraps text in a prosody element only when slowed', async () => {
    const bodies: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (_u: unknown, init: { body?: string }) => {
      bodies.push(init.body ?? '')
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }
    }) as unknown as typeof fetch

    try {
      const p = new AzureTtsProvider('key', 'eastus', 'v')
      await p.synth('hello', 0)
      await p.synth('hello', -40)
    } finally {
      globalThis.fetch = original
    }

    expect(bodies[0]).not.toContain('prosody')
    expect(bodies[1]).toContain("rate='-40%'")
  })
})
