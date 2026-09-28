import type { VideoEvent } from '../src/shared/video.js'

const get = (id: string): HTMLElement => document.getElementById(id)!
const duration = (ms: number): string => `${(Math.max(0, ms) / 1000).toFixed(3)} s`

/** One click-to-result clock, independent of provider progress or later actions. */
export class SummaryTiming {
  private started = 0
  private openingMs = 0
  private connectionMs = 0
  private transcriptStarted: number | null = null
  private transcriptMs = 0
  private transcriptDone = false
  private requestStarted: number | null = null
  private requestMs = 0
  private displayStarted: number | null = null
  private ticker: ReturnType<typeof setInterval> | null = null

  start(clickedAt?: number): void {
    this.reset()
    this.started = performance.now()
    // Content script and panel have different time origins. Carry the original
    // click across contexts once, then use a monotonic local clock for the run.
    this.openingMs = clickedAt === undefined ? 0 : Math.max(0, performance.timeOrigin + this.started - clickedAt)
    get('timing').hidden = false
    get('timing-label').textContent = 'Elapsed'
    get('timing-model').textContent = 'Connecting to your video model…'
    get('timing-opening').textContent = duration(this.openingMs)
    get('timing-connection').textContent = 'In progress'
    get('timing-transcript').textContent = 'Waiting'
    get('timing-request').textContent = 'Waiting'
    get('timing-transfer').textContent = 'Waiting'
    get('timing-display').textContent = 'Waiting'
    get('timing-note').textContent = 'From your click until the summary is ready to display.'
    this.tick()
    this.ticker = setInterval(() => this.tick(), 100)
  }

  model(name: string): void { get('timing-model').textContent = name }

  loadingTranscript(): void {
    this.transcriptStarted = performance.now()
    this.connectionMs = this.transcriptStarted - this.started
    get('timing-connection').textContent = duration(this.connectionMs)
    this.tick()
  }

  loadedTranscript(): void {
    this.requestStarted = performance.now()
    if (this.transcriptStarted !== null) this.transcriptMs = this.requestStarted - this.transcriptStarted
    this.transcriptStarted = null
    this.transcriptDone = true
    get('timing-transcript').textContent = duration(this.transcriptMs)
    get('timing-request').textContent = 'In progress'
    get('timing-transfer').textContent = 'In progress'
  }

  receivedResult(): void {
    this.displayStarted = performance.now()
    if (this.requestStarted !== null) this.requestMs = this.displayStarted - this.requestStarted
    get('timing-display').textContent = 'In progress'
  }

  finish(event: VideoEvent): void {
    if (this.ticker === null) return
    const now = performance.now()
    const total = this.openingMs + now - this.started
    this.clearTicker()
    get('timing-label').textContent = event.cached ? 'Saved summary loaded' : 'Click → summary ready'
    get('timing-total').textContent = duration(total)
    const modelMs = event.cached ? 0 : event.timing?.modelMs
    // Keep the origin and model cost visible even when the breakdown is closed.
    get('timing-source').textContent = event.cached
      ? 'Cached summary · No model call'
      : `Fresh model response · ${modelMs === undefined ? 'Model time unavailable' : `${duration(modelMs)} model time`}`
    get('timing-source').hidden = false
    get('timing-request').textContent = event.cached ? 'Not called (cached)' : modelMs === undefined ? 'Unavailable' : duration(modelMs)
    get('timing-transfer').textContent = modelMs === undefined ? 'Unavailable' : duration(this.requestMs - modelMs)
    get('timing-display').textContent = this.displayStarted === null ? 'Unavailable' : duration(now - this.displayStarted)
    get('timing-note').textContent = event.cached
      ? 'Loaded from EasyUnderstand’s local summary cache (up to 7 days, 30 entries). Helper & transfer includes loading the saved summary and sending it to the panel. Summarize again makes a fresh model request.'
      : 'One model request, including network time and response validation. Helper & transfer is the remaining request time for preparation, cache saving, and communication. Display includes rendering and waiting for the browser to paint. Summarize again makes a fresh request.'
  }

  stop(outcome: 'Cancelled' | 'Failed'): void {
    if (this.ticker === null) return
    this.tick()
    this.clearTicker()
    get('timing-label').textContent = `${outcome} after`
    if (this.transcriptStarted !== null) get('timing-transcript').textContent += ' (unfinished)'
    get('timing-request').textContent = this.transcriptDone ? 'Not completed' : 'Not called'
    if (!this.transcriptDone && this.transcriptStarted === null) get('timing-connection').textContent += ' (unfinished)'
    get('timing-transfer').textContent = 'Not completed'
    get('timing-display').textContent = 'Not completed'
    get('timing-note').textContent = 'Stopped before a complete summary. This is not a completed speed measurement.'
  }

  reset(): void {
    this.clearTicker()
    this.transcriptStarted = null
    this.transcriptMs = 0
    this.transcriptDone = false
    this.connectionMs = 0
    this.requestStarted = null
    this.requestMs = 0
    this.displayStarted = null
    get('timing-source').hidden = true
    get('timing-source').textContent = ''
    get('timing').hidden = true
  }

  private elapsed(): number { return this.openingMs + performance.now() - this.started }
  private tick(): void {
    get('timing-total').textContent = duration(this.elapsed())
    if (!this.transcriptDone && this.transcriptStarted === null) get('timing-connection').textContent = duration(performance.now() - this.started)
    if (this.transcriptStarted !== null) get('timing-transcript').textContent = duration(performance.now() - this.transcriptStarted)
  }
  private clearTicker(): void {
    if (this.ticker !== null) clearInterval(this.ticker)
    this.ticker = null
  }
}
