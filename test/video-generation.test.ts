import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LlmProvider } from '../src/providers/llm/types.js'
import { generateVideoJson, type VideoCallProgress } from '../src/core/video-generation.js'
import { sourcesField } from '../src/core/video.js'

const validate = (value: unknown): number[] => sourcesField((value as { sources: unknown }).sources, 101, 103)
function provider(generate: LlmProvider['generate']): LlmProvider {
  return { id: 'openai', label: 'Test', generate, async *explain() {}, async ping() {} }
}
const signal = (): AbortSignal => new AbortController().signal
afterEach(() => vi.useRealTimers())

describe('video model requests', () => {
  it('corrects an out-of-section citation using the original evidence without clamping it', async () => {
    const requests: string[] = []
    const model = provider(async function* (request) {
      requests.push(request.user)
      yield requests.length === 1 ? '{"sources":[1]}' : '{"sources":[102]}'
    })
    const result = await generateVideoJson(model, '[101] A\n[102] Supporting claim\n[103] B', signal(), validate, () => {})
    expect(result).toEqual([102])
    expect(requests).toHaveLength(2)
    expect(requests[1]).toContain('[102] Supporting claim')
    expect(requests[1]).toContain('101–103')
    expect(requests[1]).toContain('Never replace an invalid ID with a random in-range ID')
  })
  it('stops after one failed correction and never retries provider errors', async () => {
    const bad = vi.fn(async function* () { yield '{"sources":[999]}' })
    await expect(generateVideoJson(provider(bad), 'Evidence', signal(), validate, () => {})).rejects.toThrow(/One automatic correction attempt/)
    expect(bad).toHaveBeenCalledTimes(2)
    const failure = vi.fn(() => { throw new Error('Provider rejected request') })
    await expect(generateVideoJson(provider(failure), 'Evidence', signal(), validate, () => {})).rejects.toThrow(/Provider rejected/)
    expect(failure).toHaveBeenCalledTimes(1)
  })
  it('shows waiting progress and aborts a stream that never produces text', async () => {
    vi.useFakeTimers()
    let upstream!: AbortSignal
    const updates: VideoCallProgress[] = []
    const model = provider((_request, abort) => {
      upstream = abort
      return { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<string>>(() => {}) }) }
    })
    const run = generateVideoJson(model, 'Evidence', signal(), validate, p => updates.push(p), { firstTextMs: 20, progressMs: 5 })
    const rejection = expect(run).rejects.toThrow(/sent no analysis text/)
    await vi.advanceTimersByTimeAsync(20)
    await rejection
    expect(updates.length).toBeGreaterThan(1)
    expect(updates.every(p => p.receivedChars === 0)).toBe(true)
    expect(upstream.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('detects a mid-response stall and cleans up on user cancellation', async () => {
    vi.useFakeTimers()
    const updates: VideoCallProgress[] = []
    const model = provider(async function* () { yield '{"sources":'; await new Promise(() => {}) })
    const stalled = generateVideoJson(model, 'Evidence', signal(), validate, p => updates.push(p), { firstTextMs: 20, idleMs: 15, progressMs: 5 })
    const rejection = expect(stalled).rejects.toThrow(/stopped sending/)
    await vi.advanceTimersByTimeAsync(15); await rejection
    expect(updates.some(p => p.receivedChars > 0)).toBe(true)
    const controller = new AbortController()
    const cancelled = generateVideoJson(model, 'Evidence', controller.signal, validate, () => {})
    const cancellation = expect(cancelled).rejects.toThrow(/user cancelled/)
    controller.abort(new Error('user cancelled'))
    await cancellation
    expect(vi.getTimerCount()).toBe(0)
  })
})
