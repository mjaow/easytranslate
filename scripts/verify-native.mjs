import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'))
const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)))
const child = spawn(process.execPath, ['out/native-host/bridge.cjs', `chrome-extension://${id}/`], { windowsHide: true })
let buffer = Buffer.alloc(0), stderr = '', passed = false, received = 0
let requestStarted = performance.now()
const timer = setTimeout(() => { console.error('Native worker timed out.', stderr); child.kill(); process.exitCode = 1 }, 20000)
child.stderr.on('data', data => { stderr += data })
child.stdout.on('data', data => {
  buffer = Buffer.concat([buffer, data])
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0)
    if (length > 1000000) throw new Error('Native stdout contains non-protocol output.')
    if (buffer.length < length + 4) return
    const result = JSON.parse(buffer.subarray(4, length + 4).toString())
    buffer = buffer.subarray(length + 4)
    assert.equal(result.id, `native-smoke-${received}`)
    assert.equal(result.type, 'result')
    assert.equal(typeof result.result.model, 'string')
    console.log(`${received ? 'Reused helper' : 'Helper startup'} → configured model ${result.result.model}: ${Math.round(performance.now() - requestStarted)} ms (no model call)`)
    if (++received < 3) ping()
    else { passed = true; clearTimeout(timer); child.stdin.end() }
  }
})
child.on('exit', code => { clearTimeout(timer); if (code || !passed) { console.error(`Native check failed (${code}). ${stderr}`); process.exitCode = 1 } })
function ping() {
  requestStarted = performance.now()
  const body = Buffer.from(JSON.stringify({ id: `native-smoke-${received}`, action: 'ping' })), header = Buffer.alloc(4)
  header.writeUInt32LE(body.length)
  // Deliberately fragment each request to exercise a reused decoder in both processes.
  child.stdin.write(header.subarray(0, 2))
  child.stdin.write(Buffer.concat([header.subarray(2), body]))
}
ping()
