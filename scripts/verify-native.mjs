import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'))
const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)))
const child = spawn(process.execPath, ['out/native-host/bridge.cjs', `chrome-extension://${id}/`], { windowsHide: true })
let buffer = Buffer.alloc(0), stderr = '', passed = false
const timer = setTimeout(() => { console.error('Native worker timed out.', stderr); child.kill(); process.exitCode = 1 }, 20000)
child.stderr.on('data', data => { stderr += data })
child.stdout.on('data', data => {
  buffer = Buffer.concat([buffer, data])
  if (buffer.length < 4) return
  const length = buffer.readUInt32LE(0)
  if (length > 1000000) throw new Error('Native stdout contains non-protocol output.')
  if (buffer.length < length + 4) return
  const result = JSON.parse(buffer.subarray(4, length + 4).toString())
  assert.equal(result.id, 'native-smoke')
  assert.equal(result.type, 'result')
  assert.equal(typeof result.result.model, 'string')
  console.log(`Native bridge → Electron → configured model: ${result.result.model}`)
  passed = true; clearTimeout(timer); child.stdin.end()
})
child.on('exit', code => { clearTimeout(timer); if (code || !passed) { console.error(`Native check failed (${code}). ${stderr}`); process.exitCode = 1 } })
const body = Buffer.from(JSON.stringify({ id: 'native-smoke', action: 'ping' })), header = Buffer.alloc(4)
header.writeUInt32LE(body.length)
// Deliberately fragment the message to exercise buffering through both processes.
child.stdin.write(header.subarray(0, 2))
child.stdin.write(Buffer.concat([header.subarray(2), body]))
