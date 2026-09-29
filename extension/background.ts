export type VideoAction = 'analyze' | 'watch-plan'
export interface PanelTarget { tabId: number; windowId: number; videoId: string | null; title: string; start: boolean; token: string; clickedAt?: number; action?: VideoAction }
export type UnderstandResponse = { ok: true } | { ok: false; error: string }
function targetFor(tab: chrome.tabs.Tab, start: boolean, clickedAt?: number, action: VideoAction = 'analyze'): PanelTarget {
  let videoId: string | null = null
  try { const u = new URL(tab.url ?? ''); if (u.origin === 'https://www.youtube.com' && u.pathname === '/watch') videoId = u.searchParams.get('v') } catch { /* non-web tab */ }
  return { tabId: tab.id!, windowId: tab.windowId, videoId, title: tab.title ?? '', start, token: crypto.randomUUID(), clickedAt, action }
}
const updates = new Map<number, Promise<void>>()
function publishTarget(next: PanelTarget, ready: Promise<void> = Promise.resolve()): Promise<void> {
  const key = `target:${next.windowId}`
  // Serialize writes, including across a cold service-worker start. A title or
  // timestamp update must not erase a click while the panel is still loading.
  const update = Promise.allSettled([updates.get(next.windowId), ready]).then(async ([, availability]) => {
    if (availability.status === 'rejected') throw availability.reason
    if (!next.start) {
      const stored = await chrome.storage.session.get(key)
      const previous = stored[key] as PanelTarget | undefined
      if (previous?.tabId === next.tabId && previous.videoId === next.videoId) {
        next = { ...previous, title: next.title }
      }
    }
    await chrome.storage.session.set({ [key]: next })
  })
  updates.set(next.windowId, update)
  const cleanup = (): void => { if (updates.get(next.windowId) === update) updates.delete(next.windowId) }
  void update.then(cleanup, cleanup)
  return update
}
async function open(tab: chrome.tabs.Tab, clickedAt = performance.timeOrigin + performance.now(), action: VideoAction = 'analyze'): Promise<void> {
  // Call open synchronously in the user gesture; async work can lose that gesture.
  const opened = chrome.sidePanel.open({ windowId: tab.windowId })
  await publishTarget(targetFor(tab, true, clickedAt, action), opened)
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse: (response: UnderstandResponse) => void) => {
  if (message?.action !== 'understand' && message?.action !== 'watch-plan') return
  let youtube = false
  try { youtube = new URL(sender.url ?? '').origin === 'https://www.youtube.com' } catch { /* no page URL */ }
  if (!youtube || sender.tab?.id === undefined || !targetFor(sender.tab, false).videoId) {
    sendResponse({ ok: false, error: 'Open a YouTube video, refresh the page, and try again.' })
    return
  }
  void open(sender.tab, typeof message.clickedAt === 'number' && Number.isFinite(message.clickedAt) ? message.clickedAt : undefined,
    message.action === 'watch-plan' ? 'watch-plan' : 'analyze')
    .then(() => sendResponse({ ok: true }), e => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }))
  // Keep the response channel open until the browser confirms the panel opened
  // and its start request was saved. Sending a message alone is not success.
  return true
})
chrome.action.onClicked.addListener(tab => { void open(tab).catch(e => console.error('Could not open EasyUnderstand:', e)) })
chrome.tabs.onActivated.addListener(info => {
  void chrome.tabs.get(info.tabId).then(tab => publishTarget(targetFor(tab, false))).catch(e => console.error('Could not update EasyUnderstand:', e))
})
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  // YouTube often updates the watch URL before the tab title during navigation.
  if (tab.active && (change.url !== undefined || change.title !== undefined)) {
    void publishTarget(targetFor(tab, false)).catch(e => console.error('Could not update EasyUnderstand:', e))
  }
})
