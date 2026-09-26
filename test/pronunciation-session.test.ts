import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Explanation, ExplainState } from '../src/shared/types.js'
import { cacheKey } from '../src/core/cache.js'
import { systemPrompt } from '../src/core/explain.js'

const fixture = vi.hoisted(() => ({
  cache: new Map<string, Explanation>(),
  shown: [] as ExplainState[],
  explain: vi.fn(async function* () {
    for (const chunk of ['## CODE\nno\n## IPA\n/dɪ', 'ˈbɪt/\n## POS\nnoun\n## ZH\n借记']) yield chunk
  })
}))

vi.mock('electron', () => ({ app: { getPath: () => '/unused' }, BrowserWindow: {}, screen: {} }))
vi.mock('../src/main/capture.js', () => ({
  captureSelection: async () => ({ ok: true, text: 'debit', raw: 'debit', elapsedMs: 1 })
}))
vi.mock('../src/main/coords.js', () => ({ dipToScreenRect: vi.fn(), screenToDip: vi.fn() }))
vi.mock('../src/main/a11y.js', () => ({ readTranscriptAtPoint: vi.fn(), readCaptionFromVideo: vi.fn() }))
vi.mock('../src/main/native/index.js', () => ({
  IS_MACOS: false, copyChordLabel: () => 'Ctrl+C', foregroundWindowTitle: vi.fn(), inputPermission: vi.fn()
}))
vi.mock('../src/main/popup.js', () => ({
  showPopup: (value: ExplainState) => fixture.shown.push(structuredClone(value)),
  updatePopup: (value: ExplainState) => fixture.shown.push(structuredClone(value)),
  hidePopup: vi.fn(), isPopupVisible: () => false
}))
vi.mock('../src/core/config.js', () => ({
  loadConfig: () => ({ llm: { provider: 'openai', models: { openai: 'qwen-flash' }, codeModel: '' } }),
  getSecret: () => null
}))
vi.mock('../src/core/cache.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/core/cache.js')>(),
  JsonLruCache: class {
    get(key: string): Explanation | undefined { return fixture.cache.get(key) }
    set(key: string, value: Explanation): void { fixture.cache.set(key, value) }
  },
  AudioCache: class {}
}))
vi.mock('../src/providers/llm/registry.js', () => ({
  createLlmProvider: () => ({ explain: fixture.explain }), describeError: vi.fn()
}))
vi.mock('../src/providers/tts/registry.js', () => ({ speak: vi.fn() }))

import { explainSelection } from '../src/main/session.js'

beforeEach(() => {
  fixture.cache.clear()
  fixture.shown.length = 0
  fixture.explain.mockClear()
})

describe('pronunciation in the lookup session', () => {
  it('sends dictionary hints and displays only dictionary IPA through streaming and repeat lookups', async () => {
    await explainSelection()
    expect(fixture.explain).toHaveBeenCalledWith(
      expect.objectContaining({ pronunciationHints: { debit: [{ ipa: '/ˈdɛbɪt/', usage: undefined }] } }),
      expect.any(AbortSignal)
    )
    expect(fixture.shown.filter((s) => s.explanation.ipa).map((s) => s.explanation.ipa))
      .toEqual(['/ˈdɛbɪt/', '/ˈdɛbɪt/', '/ˈdɛbɪt/'])
    expect([...fixture.cache.values()][0].ipa).toBe('/ˈdɛbɪt/')

    await explainSelection()
    expect(fixture.explain).toHaveBeenCalledTimes(1)
    expect(fixture.shown.at(-1)).toMatchObject({ cached: true, explanation: { ipa: '/ˈdɛbɪt/' } })
  })

  it('invalidates pre-dictionary cached answers instead of trusting their old IPA choice', async () => {
    const legacyKey = cacheKey('openai', 'qwen-flash', 'word', systemPrompt('word'), 'debit', undefined)
    fixture.cache.set(legacyKey, { ipa: '/dɪˈbɪt/', zh: 'stale answer' })
    await explainSelection()
    expect(fixture.explain).toHaveBeenCalledTimes(1)
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'done', explanation: { ipa: '/ˈdɛbɪt/', zh: '借记' } })
    expect(fixture.shown.some((s) => s.explanation.zh === 'stale answer')).toBe(false)
  })
})
