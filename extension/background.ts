export interface PanelTarget { tabId: number; windowId: number; videoId: string | null; title: string; start: boolean; token: string; clickedAt?: number }
function targetFor(tab: chrome.tabs.Tab, start: boolean, clickedAt?: number): PanelTarget {
  let videoId: string | null = null
  try { const u = new URL(tab.url ?? ''); if (u.origin === 'https://www.youtube.com' && u.pathname === '/watch') videoId = u.searchParams.get('v') } catch { /* non-web tab */ }
  return { tabId: tab.id!, windowId: tab.windowId, videoId, title: tab.title ?? '', start, token: crypto.randomUUID(), clickedAt }
}
function open(tab: chrome.tabs.Tab, clickedAt = performance.timeOrigin + performance.now()): void {
  // Call open synchronously in the user gesture; async work can lose that gesture.
  void chrome.storage.session.set({ [`target:${tab.windowId}`]: targetFor(tab, true, clickedAt) })
  void chrome.sidePanel.open({ windowId: tab.windowId })
}
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.action === 'understand' && sender.tab?.id && sender.url?.startsWith('https://www.youtube.com/watch?')) {
    open(sender.tab, typeof message.clickedAt === 'number' && Number.isFinite(message.clickedAt) ? message.clickedAt : undefined)
  }
})
chrome.action.onClicked.addListener(tab => open(tab))
chrome.tabs.onActivated.addListener(info => {
  void chrome.tabs.get(info.tabId).then(tab => chrome.storage.session.set({ [`target:${tab.windowId}`]: targetFor(tab, false) }))
})
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (tab.active && change.url) void chrome.storage.session.set({ [`target:${tab.windowId}`]: targetFor(tab, false) })
})
