(() => {
  function mount(): void {
    const existing = document.getElementById('easytranslate-understand')
    if (location.pathname !== '/watch') { existing?.remove(); return }
    if (existing) return
    const container = document.querySelector('ytd-watch-metadata #actions')
    if (!container) return
    const button = document.createElement('button')
    button.id = 'easytranslate-understand'
    button.textContent = 'Understand video'
    button.title = 'English analysis from the full transcript · EasyTranslate'
    button.style.cssText = 'border:1px solid #7ebcb3;background:#163c36;color:#fff;border-radius:20px;padding:0 16px;height:36px;font:500 14px Roboto,Arial,sans-serif;cursor:pointer;white-space:nowrap;margin-right:8px;'
    let reconnect = false
    button.addEventListener('click', async () => {
      if (reconnect) { location.reload(); return }
      try {
        // Reloading an unpacked extension invalidates existing content scripts.
        // sendMessage can throw before it returns a promise, so catch both paths.
        if (!chrome.runtime?.id) throw new Error('The extension was reloaded.')
        await chrome.runtime.sendMessage({ action: 'understand', clickedAt: performance.timeOrigin + performance.now() })
      } catch {
        reconnect = true
        button.textContent = 'Reload YouTube to reconnect'
        button.title = 'Click to refresh this YouTube tab and reconnect to EasyTranslate.'
        observer.disconnect()
        if (scheduled !== null) clearTimeout(scheduled)
        document.removeEventListener('yt-navigate-finish', mount)
      }
    })
    container.prepend(button)
  }
  let scheduled: ReturnType<typeof setTimeout> | null = null
  const observer = new MutationObserver(() => {
    if (scheduled === null) scheduled = setTimeout(() => { scheduled = null; mount() }, 400)
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  document.addEventListener('yt-navigate-finish', mount)
  mount()
})()
