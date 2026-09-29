import { JSDOM, VirtualConsole } from 'jsdom'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const code = await readFile('out/extension/content.js', 'utf8')
for (const action of ['understand', 'watch-plan']) for (const failure of ['none', 'delayed', 'open-failed', 'timeout', 'no-response', 'throw', 'reject', 'missing-context']) {
  const errors = [], messages = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error.message))
  const dom = new JSDOM('<ytd-watch-metadata><div id="actions"></div></ytd-watch-metadata>', {
    url: 'https://www.youtube.com/watch?v=B7yl7fEHeKM', runScripts: 'outside-only', virtualConsole
  })
  let reloads = 0
  const w = dom.window
  let finishOpening, requestTimeout
  const schedule = w.setTimeout.bind(w)
  w.setTimeout = (callback, ms) => {
    if (ms === 10000) requestTimeout = callback
    return schedule(callback, ms)
  }
  w.chrome = { runtime: {
    id: failure === 'missing-context' ? undefined : 'fixture-extension',
    sendMessage: message => {
      messages.push(message)
      if (failure === 'throw') throw new Error('Extension context invalidated.')
      if (failure === 'reject') return Promise.reject(new Error('Could not establish connection.'))
      if (failure === 'no-response') return Promise.resolve()
      if (messages.length === 1) {
        if (failure === 'delayed' || failure === 'timeout') return new Promise(resolve => { finishOpening = resolve })
        if (failure === 'open-failed') return Promise.resolve({ ok: false, error: 'Panel needs a user gesture.' })
      }
      return Promise.resolve({ ok: true })
    }
  } }
  // Keep refresh inside this fixture rather than navigating a real browser tab.
  w.fixtureLocation = { pathname: '/watch', reload: () => { reloads++ } }
  w.eval(`(function(location) { ${code}\n})(window.fixtureLocation)`)
  assert.equal(w.document.querySelectorAll('#easytranslate-understand').length, 1)
  assert.equal(w.document.querySelectorAll('#easytranslate-plan-watch').length, 1)
  const label = action === 'understand' ? 'Understand video' : 'Plan watch'
  const button = w.document.getElementById(action === 'understand' ? 'easytranslate-understand' : 'easytranslate-plan-watch')
  button.click()
  if (['none', 'delayed', 'open-failed', 'timeout', 'no-response', 'reject'].includes(failure)) {
    assert.equal(button.textContent, 'Opening EasyUnderstand…')
    assert.equal(button.disabled, true)
    button.click()
    w.document.getElementById(action === 'understand' ? 'easytranslate-plan-watch' : 'easytranslate-understand').click()
    assert.equal(messages.length, 1, 'a pending open cannot be submitted twice')
  }
  if (failure === 'delayed') finishOpening({ ok: true })
  if (failure === 'timeout') requestTimeout()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(messages.length, failure === 'missing-context' ? 0 : 1)
  assert.equal(button.disabled, false)
  const feedback = w.document.getElementById('easytranslate-feedback')
  if (failure === 'none' || failure === 'delayed') {
    assert.equal(button.textContent, label)
    assert.equal(messages[0].action, action)
    assert.ok(Number.isFinite(messages[0].clickedAt))
    assert.equal(reloads, 0)
    assert.equal(feedback.hidden, true)
    w.fixtureLocation.pathname = '/'
    w.document.dispatchEvent(new w.Event('yt-navigate-finish'))
    assert.equal(w.document.getElementById('easytranslate-understand'), null)
    assert.equal(w.document.getElementById('easytranslate-feedback'), null)
    assert.equal(w.document.getElementById('easytranslate-plan-watch'), null)
  } else if (failure === 'open-failed' || failure === 'timeout') {
    assert.equal(button.textContent, `Retry ${label}`)
    assert.equal(feedback.hidden, false)
    assert.match(feedback.textContent, /toolbar icon/)
    assert.match(feedback.textContent, failure === 'timeout' ? /did not respond/ : /user gesture/)
    button.click()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(button.textContent, label)
    assert.equal(feedback.hidden, true)
    assert.equal(messages.length, 2)
    assert.equal(reloads, 0, 'a browser opening failure can retry without reloading the video')
  } else {
    assert.equal(button.textContent, 'Reload YouTube to reconnect')
    button.click()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(reloads, 1, 'the reconnect button refreshes the tab instead of messaging a dead context again')
    assert.equal(messages.length, failure === 'missing-context' ? 0 : 1)
  }
  assert.deepEqual(errors, [], `no uncaught content-script error for ${failure}`)
  dom.window.close()
}
console.log('Both YouTube buttons acknowledge opening, prevents duplicate clicks, shows retryable opening errors/timeouts, and reconnects missing or invalidated extension contexts.')
