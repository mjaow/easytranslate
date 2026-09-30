// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelTarget, VideoAction } from '../extension/background.js'
import type { VideoEvent, VideoRequest, VideoTranscript } from '../src/shared/video.js'

const transcript: VideoTranscript = {
  videoId: 'jNQXAC9IVRw', title: 'Current lecture', language: 'en', automatic: false,
  duration: 60, source: 'caption-track', complete: true,
  segments: [{ start: 0, duration: 60, text: 'Learn how the method works.' }]
}
const requests: VideoRequest[] = []
const stored: Record<string, unknown> = {}
let onChange: Parameters<typeof chrome.storage.onChanged.addListener>[0]
const query = vi.fn(), readStorage = vi.fn()
const get = (id: string): HTMLElement => document.getElementById(id)!
function target(action: VideoAction, token = 'first-click'): PanelTarget {
  return { tabId: 2, windowId: 1, videoId: transcript.videoId, title: transcript.title,
    start: true, token, action, clickedAt: performance.timeOrigin + performance.now() }
}
function publish(next: PanelTarget): void {
  stored['target:1'] = next
  onChange({ 'target:1': { newValue: next } }, 'session')
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function finished(action: VideoAction): Promise<void> {
  await vi.waitFor(() => {
    expect((get(action === 'watch-plan' ? 'plan-watch' : 'understand') as HTMLButtonElement).disabled).toBe(false)
    expect(get('error').hidden).toBe(true)
    expect(get(action === 'watch-plan' ? 'watch-result' : 'overview-card').hidden).toBe(false)
  })
}
function expectView(action: VideoAction): void {
  const planning = action === 'watch-plan'
  expect(get('panel-heading').textContent).toBe(planning ? 'Plan watch' : 'Understand video')
  expect(get('understand').hidden).toBe(planning)
  expect(get('plan-watch').hidden).toBe(!planning)
  expect(get('summary-view').hidden).toBe(planning)
  expect(get('summary-timing-view').hidden).toBe(planning)
  expect(get('watch-plan-section').hidden).toBe(!planning)
}

beforeEach(() => {
  vi.resetModules()
  requests.length = 0
  for (const key of Object.keys(stored)) delete stored[key]
  document.body.innerHTML = readFileSync('extension/sidepanel.html', 'utf8')
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  query.mockReset().mockResolvedValue([{ id: 2, windowId: 1, url: `https://www.youtube.com/watch?v=${transcript.videoId}` }])
  readStorage.mockReset().mockImplementation(async () => ({ ...stored }))
  vi.stubGlobal('chrome', {
    windows: { getCurrent: async () => ({ id: 1 }) },
    storage: { session: {
      get: readStorage,
      set: async (values: Record<string, unknown>) => { Object.assign(stored, values) }
    }, onChanged: { addListener: (listener: typeof onChange) => { onChange = listener } } },
    tabs: { query },
    scripting: { executeScript: async () => [{ result: { transcript } }] },
    runtime: { connectNative: () => {
      let listener: (event: VideoEvent) => void
      let disconnected = false
      return {
        onMessage: { addListener: (callback: typeof listener) => { listener = callback } },
        onDisconnect: { addListener: vi.fn() },
        disconnect: () => { disconnected = true },
        postMessage: (request: VideoRequest) => {
          requests.push(request)
          const result: VideoEvent['result'] = request.action === 'ping' ? { model: 'fixture' }
            : request.action === 'watch-plan' ? { model: 'fixture', overview: 'Focus on the method.', sections: [{
              firstCaption: 1, lastCaption: 1, title: 'The method', recommendation: 'focus', reason: 'The core explanation.',
              learningTarget: 'Explain the method.', skipCondition: '', prerequisites: []
            }] }
              : { model: 'fixture', overview: 'How the method works.', takeaways: [], ideas: [], evaluation: [], connections: '', unanswered: [], sections: 1 }
          queueMicrotask(() => { if (!disconnected) listener({ id: request.id, type: 'result', result }) })
        }
      }
    } }
  })
})
afterEach(() => {
  get('cancel').click()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('one-click video panels', () => {
  it.each<VideoAction>(['analyze', 'watch-plan'])('opens only the %s view and starts it without a second click', async action => {
    stored['target:1'] = target(action)
    await import('../extension/sidepanel.js')
    await finished(action)
    expectView(action)
    expect(requests.map(request => request.action)).toEqual(['ping', action])
    publish({ ...target(action), title: 'Delayed title' })
    expect(requests.map(request => request.action)).toEqual(['ping', action])
  })

  it.each<VideoAction>(['analyze', 'watch-plan'])('loads %s when a previous panel recorded the click but closed before displaying it', async action => {
    stored['target:1'] = { ...target(action), clickedAt: 1 }
    stored['started:1'] = 'first-click'
    await import('../extension/sidepanel.js')
    await finished(action)
    expectView(action)
    expect(requests.map(request => request.action)).toEqual(['ping', action])
    expect(requests.at(-1)).toMatchObject({ fresh: false })
    if (action === 'analyze') expect(get('timing-opening').textContent).toBe('0.000 s')
  })

  it('keeps a first click that arrives during the initial storage read', async () => {
    const initialRead = deferred<Record<string, unknown>>()
    readStorage.mockReturnValueOnce(initialRead.promise)
    const opening = import('../extension/sidepanel.js')
    await vi.waitFor(() => expect(readStorage).toHaveBeenCalled())
    publish(target('watch-plan'))
    initialRead.resolve({ 'target:1': { ...target('analyze', 'old'), start: false } })
    await opening
    await finished('watch-plan')
    expectView('watch-plan')
    expect(requests.map(request => request.action)).toEqual(['ping', 'watch-plan'])
  })

  it.each<VideoAction>(['analyze', 'watch-plan'])('does not cancel the first %s click when a stale tab lookup finishes', async action => {
    const activeTab = deferred<chrome.tabs.Tab[]>()
    query.mockReturnValueOnce(activeTab.promise)
    const opening = import('../extension/sidepanel.js')
    await vi.waitFor(() => expect(query).toHaveBeenCalled())
    publish(target(action))
    activeTab.resolve([{ id: 99, windowId: 1, url: 'https://www.youtube.com/watch?v=old-video' } as chrome.tabs.Tab])
    await opening
    await finished(action)
    expectView(action)
    expect(requests.map(request => request.action)).toEqual(['ping', action])
    expect(get('video-title').textContent).toBe(transcript.title)
  })

  it('switches directly between the separate views from new page clicks', async () => {
    stored['target:1'] = target('analyze')
    await import('../extension/sidepanel.js')
    await finished('analyze')
    publish(target('watch-plan', 'plan-click'))
    await finished('watch-plan')
    expectView('watch-plan')
    publish(target('analyze', 'summary-click'))
    await finished('analyze')
    expectView('analyze')
    expect(requests.map(request => request.action)).toEqual(['ping', 'analyze', 'ping', 'watch-plan', 'ping', 'analyze'])
  })
})
