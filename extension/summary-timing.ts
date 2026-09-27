import type { VideoEvent } from '../src/shared/video.js'

const get = (id: string): HTMLElement => document.getElementById(id)!
const duration = (ms: number): string => `${(Math.max(0, ms) / 1000).toFixed(3)} s`

/** One click-to-result clock, independent of provider progress or later actions. */
export class SummaryTiming {
  private started = 0
  private openingMs = 0
  private transcriptStarted: number | null = null
  private transcriptMs = 0
  private transcriptDone = false
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
    get('timing-transcript').textContent = 'Waiting'
    get('timing-request').textContent = 'Waiting'
    get('timing-other').textContent = 'In progress'
    get('timing-note').textContent = 'From your click until the summary is ready to display.'
    this.tick()
    this.ticker = setInterval(() => this.tick(), 100)
  }

  model(name: string): void { get('timing-model').textContent = name }

  loadingTranscript(): void {
    this.transcriptStarted = performance.now()
    this.tick()
  }

  loadedTranscript(): void {
    if (this.transcriptStarted !== null) this.transcriptMs = performance.now() - this.transcriptStarted
    this.transcriptStarted = null
    this.transcriptDone = true
    get('timing-transcript').textContent = duration(this.transcriptMs)
    get('timing-request').textContent = 'In progress'
  }

  finish(event: VideoEvent): void {
    if (this.ticker === null) return
    const total = this.elapsed()
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
    get('timing-other').textContent = modelMs === undefined ? 'Unavailable' : duration(total - this.transcriptMs - modelMs)
    get('timing-note').textContent = event.cached
      ? 'Loaded from EasyTranslate’s local summary cache (up to 7 days, 30 entries). Time went to collecting captions, connecting, loading the saved summary, and displaying it. Summarize again makes a fresh model request.'
      : 'One model request, including network time and response validation. Total includes opening, connecting, and display. Summarize again makes a fresh request.'
  }

  stop(outcome: 'Cancelled' | 'Failed'): void {
    if (this.ticker === null) return
    this.tick()
    this.clearTicker()
    get('timing-label').textContent = `${outcome} after`
    if (this.transcriptStarted !== null) get('timing-transcript').textContent += ' (unfinished)'
    get('timing-request').textContent = this.transcriptDone ? 'Not completed' : 'Not called'
    get('timing-other').textContent = 'Not completed'
    get('timing-note').textContent = 'Stopped before a complete summary. This is not a completed speed measurement.'
  }

  reset(): void {
    this.clearTicker()
    this.transcriptStarted = null
    this.transcriptMs = 0
    this.transcriptDone = false
    get('timing-source').hidden = true
    get('timing-source').textContent = ''
    get('timing').hidden = true
  }

  private elapsed(): number { return this.openingMs + performance.now() - this.started }
  private tick(): void {
    get('timing-total').textContent = duration(this.elapsed())
    if (this.transcriptStarted !== null) get('timing-transcript').textContent = duration(performance.now() - this.transcriptStarted)
  }
  private clearTicker(): void {
    if (this.ticker !== null) clearInterval(this.ticker)
    this.ticker = null
  }
}
