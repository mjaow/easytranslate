import { createServer, type Socket } from 'node:net'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { NativeDecoder, encodeNative } from '../core/native-protocol.js'

// A Node native host owns Chromium's stdio. Electron on Windows reattaches console
// handles, so it communicates over a private pipe instead of touching those handles.
const root = resolve(__dirname, '../..')
const manifest = JSON.parse(readFileSync(join(root, 'out/extension/manifest.json'), 'utf8')) as { key: string }
const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)))
if (!process.argv.includes(`chrome-extension://${extensionId}/`)) {
  console.error('Unrecognized native messaging caller.'); process.exit(1)
}
const directory = process.platform === 'win32' ? null : mkdtempSync(join(tmpdir(), 'easytranslate-video-'))
const pipe = directory ? join(directory, 'worker.sock') : `\\\\.\\pipe\\easytranslate-video-${randomUUID()}`
const token = randomBytes(32).toString('hex')
let socket: Socket | null = null
let queued = Buffer.alloc(0)
let worker: ReturnType<typeof spawn> | null = null
let ending = false
const finish = (): void => {
  if (ending) return
  ending = true
  clearTimeout(startup)
  process.stdin.destroy()
  socket?.destroy(); server.close(); worker?.kill()
  if (directory) { try { rmSync(directory, { recursive: true, force: true }) } catch { /* already removed */ } }
}
const startup = setTimeout(() => { console.error('EasyTranslate worker did not start.'); finish(); process.exitCode = 1 }, 20000)
const server = createServer(connection => {
  const decoder = new NativeDecoder()
  let authenticated = false
  connection.on('data', data => {
    try {
      for (const value of decoder.feed(data)) {
        if (!authenticated) {
          if ((value as { token?: string })?.token !== token || socket) { connection.destroy(); return }
          authenticated = true; socket = connection; clearTimeout(startup)
          if (queued.length) connection.write(queued)
          queued = Buffer.alloc(0)
        } else if (!process.stdout.write(encodeNative(value))) {
          connection.pause(); process.stdout.once('drain', () => connection.resume())
        }
      }
    } catch { connection.destroy() }
  })
  connection.on('error', () => { if (socket === connection) finish() })
  connection.on('close', () => { if (socket === connection) finish() })
})
server.on('error', err => { console.error(err.message); finish(); process.exitCode = 1 })
server.listen(pipe, () => {
  const executable = process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron'
  const env: NodeJS.ProcessEnv = { ...process.env, EASYTRANSLATE_VIDEO_PIPE: pipe, EASYTRANSLATE_VIDEO_TOKEN: token }
  delete env.ELECTRON_RUN_AS_NODE
  worker = spawn(join(root, 'node_modules/electron/dist', executable), [join(root, 'out/main/native-host.js')], { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  worker.stderr?.on('data', data => process.stderr.write(data))
  worker.on('error', err => { console.error(err.message); finish() })
  worker.on('exit', finish)
})
process.stdin.on('data', data => {
  if (socket) { if (!socket.write(data)) { process.stdin.pause(); socket.once('drain', () => process.stdin.resume()) } }
  else { queued = Buffer.concat([queued, data]); if (queued.length > 8000004) finish() }
})
process.stdin.on('end', finish)
process.stdin.on('error', finish)
process.stdout.on('error', finish)
process.on('SIGTERM', () => { finish(); process.exit(0) })
