import { JSDOM, VirtualConsole } from 'jsdom'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const code = await readFile('out/extension/content.js', 'utf8')
for (const failure of ['none', 'throw', 'reject', 'missing-context']) {
  const errors = [], messages = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error.message))
  const dom = new JSDOM('<ytd-watch-metadata><div id="actions"></div></ytd-watch-metadata>', {
    url: 'https://www.youtube.com/watch?v=B7yl7fEHeKM', runScripts: 'outside-only', virtualConsole
  })
  let reloads = 0
  const w = dom.window
  w.chrome = { runtime: {
    id: failure === 'missing-context' ? undefined : 'fixture-extension',
    sendMessage: message => {
      messages.push(message)
      if (failure === 'throw') throw new Error('Extension context invalidated.')
      if (failure === 'reject') return Promise.reject(new Error('Could not establish connection.'))
      return Promise.resolve()
    }
  } }
  // Keep refresh inside this fixture rather than navigating a real browser tab.
  w.fixtureLocation = { pathname: '/watch', reload: () => { reloads++ } }
  w.eval(`(function(location) { ${code}\n})(window.fixtureLocation)`)
  assert.equal(w.document.querySelectorAll('#easytranslate-understand').length, 1)
  const button = w.document.getElementById('easytranslate-understand')
  button.click()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(messages.length, failure === 'missing-context' ? 0 : 1)
  if (failure === 'none') {
    assert.equal(button.textContent, 'Understand video')
    assert.equal(messages[0].action, 'understand')
    assert.ok(Number.isFinite(messages[0].clickedAt))
    assert.equal(reloads, 0)
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
console.log('YouTube button handles healthy messaging, synchronous reload errors, rejected messages, and invalidated contexts; reconnect refreshes the tab.')
