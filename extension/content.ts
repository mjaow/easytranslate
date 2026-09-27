import type { UnderstandResponse } from './background.js'

(() => {
  function mount(): void {
    const existing = document.getElementById('easytranslate-understand')
    if (location.pathname !== '/watch') { existing?.remove(); document.getElementById('easytranslate-feedback')?.remove(); return }
    if (existing) return
    const container = document.querySelector('ytd-watch-metadata #actions')
    if (!container) return
    const button = document.createElement('button')
    button.id = 'easytranslate-understand'
    button.textContent = 'Understand video'
    button.title = 'English analysis from the full transcript · EasyUnderstand'
    button.style.cssText = 'border:1px solid #7ebcb3;background:#163c36;color:#fff;border-radius:20px;padding:0 16px;height:36px;font:500 14px Roboto,Arial,sans-serif;cursor:pointer;white-space:nowrap;margin-right:8px;'
    const feedback = document.createElement('span')
    feedback.id = 'easytranslate-feedback'
    feedback.setAttribute('role', 'status')
    feedback.style.cssText = 'font:13px Roboto,Arial,sans-serif;color:var(--yt-spec-text-primary,#111);align-self:center;max-width:320px;margin-right:8px;'
    feedback.hidden = true
    button.setAttribute('aria-describedby', feedback.id)
    let reconnect = false
    button.addEventListener('click', async () => {
      if (reconnect) { location.reload(); return }
      button.disabled = true
      button.textContent = 'Opening EasyUnderstand…'
      feedback.hidden = true
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        // Reloading an unpacked extension invalidates existing content scripts.
        // sendMessage can throw before it returns a promise, so catch both paths.
        if (!chrome.runtime?.id) throw new Error('The extension was reloaded.')
        const response: UnderstandResponse | undefined = await Promise.race([
          chrome.runtime.sendMessage({ action: 'understand', clickedAt: performance.timeOrigin + performance.now() }),
          new Promise<UnderstandResponse>(resolve => {
            timeout = setTimeout(() => resolve({ ok: false, error: 'The extension did not respond. Reload this YouTube tab if retrying does not help.' }), 10000)
          })
        ])
        if (!response) throw new Error('The extension did not confirm the request.')
        if (!response.ok) {
          button.textContent = 'Retry Understand video'
          button.title = response.error
          feedback.textContent = `Could not open EasyUnderstand. Try again or use its browser toolbar icon. ${response.error}`
          feedback.hidden = false
          return
        }
        button.textContent = 'Understand video'
        button.title = 'English analysis from the full transcript · EasyUnderstand'
      } catch {
        reconnect = true
        button.textContent = 'Reload YouTube to reconnect'
        button.title = 'Click to refresh this YouTube tab and reconnect to EasyUnderstand.'
        feedback.textContent = 'EasyUnderstand disconnected. Click to reload this YouTube tab.'
        feedback.hidden = false
        observer.disconnect()
        if (scheduled !== null) clearTimeout(scheduled)
        document.removeEventListener('yt-navigate-finish', mount)
      } finally {
        clearTimeout(timeout)
        button.disabled = false
      }
    })
    document.getElementById(feedback.id)?.remove()
    container.prepend(button, feedback)
  }
  let scheduled: ReturnType<typeof setTimeout> | null = null
  const observer = new MutationObserver(() => {
    if (scheduled === null) scheduled = setTimeout(() => { scheduled = null; mount() }, 400)
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  document.addEventListener('yt-navigate-finish', mount)
  mount()
})()
