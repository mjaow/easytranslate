import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let updated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0]
const save = vi.fn()
beforeEach(async () => {
  vi.resetModules()
  save.mockReset()
  vi.stubGlobal('chrome', {
    runtime: { onMessage: { addListener: vi.fn() } },
    action: { onClicked: { addListener: vi.fn() } },
    tabs: { onActivated: { addListener: vi.fn() }, onUpdated: { addListener: (listener: typeof updated) => { updated = listener } } },
    storage: { session: { set: save } }
  })
  await import('../extension/background.js')
})
afterEach(() => vi.unstubAllGlobals())

describe('video panel target updates', () => {
  const tab = { id: 2, windowId: 1, active: true, url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', title: 'Old video - YouTube' } as chrome.tabs.Tab

  it('publishes a title-only update after YouTube changes the URL before its title', () => {
    updated(tab.id!, { url: tab.url }, tab)
    expect(save).toHaveBeenLastCalledWith({ 'target:1': expect.objectContaining({ videoId: 'jNQXAC9IVRw', title: tab.title, start: false }) })
    updated(tab.id!, { title: 'New lecture - YouTube' }, { ...tab, title: 'New lecture - YouTube' })
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({ 'target:1': expect.objectContaining({ videoId: 'jNQXAC9IVRw', title: 'New lecture - YouTube', start: false }) })
  })
  it('does not replace the active target for an inactive tab or an unrelated update', () => {
    updated(tab.id!, { title: 'Inactive video' }, { ...tab, active: false })
    updated(tab.id!, { status: 'complete' }, tab)
    expect(save).not.toHaveBeenCalled()
  })
})
