import { app } from 'electron'
import { join } from 'node:path'
import { connect, type Socket } from 'node:net'
import { NativeDecoder, encodeNative } from '../core/native-protocol.js'
import { handleVideo } from './video-service.js'
import type { VideoRequest } from '../shared/video.js'
import { describeError } from '../providers/llm/registry.js'
import { loadConfig } from '../core/config.js'
import { videoPackets } from '../shared/video-wire.js'

// A separate, windowless Electron process uses the same OS-encrypted settings.
// It does not acquire hotkeys, create a tray, or contend for the desktop app lock.
app.setName('easytranslate')
app.setPath('userData', join(app.getPath('appData'), 'easytranslate'))
app.disableHardwareAcceleration()
console.log = (...args: unknown[]) => console.error(...args)
let active: AbortController | null = null
const decoder = new NativeDecoder()
let connection: Socket
const send = (value: unknown): void => { connection.write(encodeNative(value)) }

void app.whenReady().then(() => {
  app.dock?.hide()
  const pipe = process.env.EASYTRANSLATE_VIDEO_PIPE
  const token = process.env.EASYTRANSLATE_VIDEO_TOKEN
  if (!pipe || !token) { app.exit(1); return }
  connection = connect(pipe, () => send({ token }))
  connection.on('data', (data: Buffer) => {
    try {
      for (const raw of decoder.feed(data)) {
        const r = raw as VideoRequest
        if (!r || typeof r.id !== 'string' || !/^[\w-]{1,80}$/.test(r.id) || !['ping', 'analyze', 'translate', 'question', 'cancel', 'clear-cache'].includes(r.action)) throw new Error('Invalid native request.')
        if (r.action === 'cancel') { active?.abort(); continue }
        if (active) { send({ id: r.id, type: 'error', message: 'Another request is still running. Cancel it first.' }); continue }
        const controller = new AbortController(); active = controller
        void handleVideo(r, e => { for (const packet of videoPackets({ id: r.id, ...e })) send(packet) }, controller.signal).catch(err => {
          const configuration = loadConfig()
          const detail = describeError(r.action === 'translate' ? configuration.llm.provider : configuration.llm.videoProvider ?? configuration.llm.provider, err)
          const message = controller.signal.aborted ? 'Cancelled.' : [detail.message, detail.hint].filter(Boolean).join('\n')
          send({ id: r.id, type: 'error', message })
        }).finally(() => { if (active === controller) active = null })
      }
    } catch (err) {
      console.error(err); active?.abort(); app.exit(1)
    }
  })
  connection.on('end', () => { active?.abort(); app.exit(0) })
  connection.on('close', () => { active?.abort(); app.exit(0) })
  connection.on('error', () => { active?.abort(); app.exit(0) })
})
