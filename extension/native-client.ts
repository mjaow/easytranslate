import type { VideoEvent, VideoRequest } from '../src/shared/video.js'
import { VideoEventReader } from '../src/shared/video-wire.js'

type Packet = Parameters<VideoEventReader['read']>[0]
interface Pending {
  reader: VideoEventReader
  resolve: (event: VideoEvent) => void
  reject: (error: Error) => void
  status: (message: string) => void
}

/** One helper per panel, with one request at a time and no automatic replay. */
export class VideoNativeClient {
  private port: chrome.runtime.Port | null = null
  private pending: Pending | null = null

  /** Start the local process only; no transcript, API key, or model call is sent. */
  warmup(): void {
    try { this.connect() } catch { this.disconnect() }
  }

  /** Navigation can retain an idle helper, but must stop an in-flight request. */
  cancelPending(): void {
    if (this.pending) this.disconnect()
  }

  request(request: VideoRequest, status: (message: string) => void): Promise<VideoEvent> {
    if (this.pending) return Promise.reject(new Error('Another request is still running. Cancel it first.'))
    return new Promise((resolve, reject) => {
      this.pending = { reader: new VideoEventReader(request.id), resolve, reject, status }
      try {
        this.connect().postMessage(request)
      } catch (error) {
        this.disconnect(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private connect(): chrome.runtime.Port {
    if (!this.port) {
      const port = chrome.runtime.connectNative('com.easytranslate.video')
      this.port = port
      port.onMessage.addListener((value: Packet) => {
        if (this.port !== port || !this.pending) return
        let event: VideoEvent | null
        try { event = this.pending.reader.read(value) } catch (error) {
          this.disconnect(error instanceof Error ? error : new Error(String(error)))
          return
        }
        if (!event) return
        if (event.type === 'status') this.pending.status(event.message ?? '')
        if (event.type === 'result' || event.type === 'error') {
          const pending = this.pending
          this.pending = null
          if (event.type === 'error') pending.reject(new Error(event.message))
          else pending.resolve(event)
        }
      })
      port.onDisconnect.addListener(() => {
        // Read lastError even for a stale port to consume Chromium's error.
        const message = chrome.runtime.lastError?.message
        if (this.port !== port) return
        this.port = null
        this.fail(new Error(message
          ? `Could not connect to EasyUnderstand. Run npm run setup:youtube from its folder, then reload this extension.\n${message}`
          : 'The helper connection closed. Try again.'))
      })
    }
    return this.port
  }

  disconnect(error = new Error('The request was cancelled.')): void {
    const port = this.port
    this.port = null
    // Locally disconnecting a Chrome port does not fire its onDisconnect event.
    this.fail(error)
    port?.disconnect()
  }

  private fail(error: Error): void {
    const pending = this.pending
    this.pending = null
    pending?.reject(error)
  }
}
