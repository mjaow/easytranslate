import { beforeEach, describe, expect, it, vi } from 'vitest'
const stored = vi.hoisted(() => ({ value: '' }))
vi.mock('electron', () => ({ app: { getPath: () => '/test' }, safeStorage: {} }))
vi.mock('node:fs', () => ({
  readFileSync: () => stored.value, existsSync: () => !!stored.value,
  writeFileSync: (_file: string, value: string) => { stored.value = value }, mkdirSync: () => {}
}))
import { loadConfig, saveConfig, __resetCache } from '../src/core/config.js'
import { resolveVideoConfig } from '../src/core/video-config.js'

const everyday = { provider: 'openai', models: { openai: 'qwen-flash' }, baseUrls: { openai: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' } }
beforeEach(() => { stored.value = ''; __resetCache() })
describe('independent video defaults', () => {
  it.each([undefined, ''])('migrates an unset video model (%s) without changing everyday settings', videoModel => {
    stored.value = JSON.stringify({ llm: { ...everyday, videoModel } })
    const saved = loadConfig()
    expect(saved.llm).toMatchObject({ ...everyday, videoProvider: 'openai', videoModel: 'gemini-3.8-flash', videoBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' })
    expect(saved.llm.videoKeyScope).toBeUndefined()
    const video = resolveVideoConfig(saved)
    expect(video.config.llm.baseUrls.openai).toContain('googleapis.com')
    expect(saved.llm.baseUrls.openai).toBe(everyday.baseUrls.openai)
    saveConfig({ launchAtLogin: true }); __resetCache()
    expect(loadConfig().llm).toEqual(saved.llm)
  })
  it('uses the independent default on a new installation', () => {
    expect(loadConfig().llm.videoModel).toBe('gemini-3.8-flash')
  })
  it('keeps an explicitly selected video endpoint, model and key scope', () => {
    const choice = { videoProvider: 'claude', videoBaseUrl: 'https://api.anthropic.com', videoModel: 'chosen-model', videoKeyScope: 'claude|https://api.anthropic.com' }
    stored.value = JSON.stringify({ llm: { ...everyday, ...choice } })
    expect(loadConfig().llm).toMatchObject({ ...everyday, ...choice })
  })
  it('keeps a legacy model override on its original endpoint instead of sending it to Google', () => {
    stored.value = JSON.stringify({ llm: { ...everyday, videoModel: 'old-video-model' } })
    expect(loadConfig().llm).toMatchObject({ ...everyday, videoModel: 'old-video-model', videoProvider: 'openai', videoBaseUrl: everyday.baseUrls.openai })
  })
  it('persists Azure protocol, deployment and versioned endpoint independently of everyday settings', () => {
    const choice = { videoProvider: 'openai', videoProtocol: 'azure-responses', videoModel: 'gpt-6-luna', videoReasoningEffort: 'none',
      videoBaseUrl: 'https://example.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview' }
    stored.value = JSON.stringify({ llm: { ...everyday, ...choice } })
    expect(loadConfig().llm).toMatchObject({ ...everyday, ...choice })
    saveConfig({ launchAtLogin: true }); __resetCache()
    expect(loadConfig().llm).toMatchObject({ ...everyday, ...choice })
  })
  it('separates cached Azure summaries by effective reasoning without changing standard-provider caches', () => {
    const saved = loadConfig()
    const azure = { ...saved, llm: { ...saved.llm, videoProtocol: 'azure-responses' as const, videoModel: 'custom-deployment' } }
    const legacy = resolveVideoConfig(azure).endpoint
    expect(legacy).toBe(resolveVideoConfig({ ...azure, llm: { ...azure.llm, videoReasoningEffort: 'low' } }).endpoint)
    expect(legacy).not.toBe(resolveVideoConfig({ ...azure, llm: { ...azure.llm, videoReasoningEffort: 'none' } }).endpoint)
    expect(resolveVideoConfig(saved).endpoint).toBe(resolveVideoConfig({ ...saved, llm: { ...saved.llm, videoReasoningEffort: 'none' } }).endpoint)
  })
})
