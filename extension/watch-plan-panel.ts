import { clockTime, type VideoEvent, type VideoRequest, type VideoTranscript, type VideoWatchPlan, type WatchPreferences } from '../src/shared/video.js'
import { DEFAULT_WATCH_PREFERENCES, nextFocusRange, watchEstimate, watchPreferences, watchRanges, WATCH_LABELS, type WatchRange } from '../src/shared/watch-plan.js'

const get = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
const preferenceKey = 'watchPreferences'
interface Hooks {
  request: (request: VideoRequest, revision: number) => Promise<VideoEvent>
  generation: () => number
  setBusy: (busy: boolean) => void
  isBusy: () => boolean
  error: (message: string) => void
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); e.textContent = text; e.className = className; return e
}

/** Own the plan separately from the summary and its English/Chinese controls. */
export class WatchPlanPanel {
  private transcript: VideoTranscript | null = null
  private tabId = 0
  private plan: VideoWatchPlan | null = null
  private ranges: WatchRange[] = []
  private dirty = false
  private pending = false
  private ready: Promise<void>

  constructor(private readonly hooks: Hooks) {
    this.ready = this.loadPreferences()
    get('watch-form').addEventListener('submit', e => { e.preventDefault(); void this.generate() })
    for (const id of ['watch-goal', 'watch-known', 'watch-budget']) get(id).addEventListener('input', () => {
      this.dirty = true
      this.clearPlan()
      get('watch-settings-summary').textContent = 'Your learning preferences'
      get('watch-status').textContent = 'Preferences changed. Create a new plan for this goal.'
    })
    get('next-focus').addEventListener('click', () => void this.nextFocus())
  }

  private async loadPreferences(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(preferenceKey)
      const preferences = stored[preferenceKey] ? watchPreferences(stored[preferenceKey]) : DEFAULT_WATCH_PREFERENCES
      if (this.dirty) return
      get<HTMLSelectElement>('watch-goal').value = preferences.goal
      get<HTMLTextAreaElement>('watch-known').value = preferences.knownTopics
      get<HTMLInputElement>('watch-budget').value = preferences.budgetMinutes?.toString() ?? ''
    } catch { /* Missing/invalid saved preferences never prevent planning. */ }
  }

  setContext(transcript: VideoTranscript | null, tabId = 0): void {
    this.transcript = transcript; this.tabId = tabId; this.pending = false
    this.clearPlan()
    get('watch-plan-section').hidden = !transcript
    get('watch-status').textContent = 'Uses your video model. Preferences are saved on this device.'
    this.setBusy(this.hooks.isBusy())
  }

  setBusy(busy: boolean): void {
    for (const id of ['watch-goal', 'watch-known', 'watch-budget', 'create-watch-plan', 'next-focus']) {
      get<HTMLInputElement>(id).disabled = busy || !this.transcript
    }
    if (!busy && this.pending) {
      this.pending = false
      get('watch-status').textContent = 'Watch plan cancelled. You can try again.'
    }
  }

  private clearPlan(): void {
    this.plan = null; this.ranges = []
    get('watch-result').hidden = true
    get('watch-ranges').replaceChildren()
    get('create-watch-plan').textContent = 'Create watch plan'
  }

  private preferences(): WatchPreferences {
    const budget = get<HTMLInputElement>('watch-budget').value
    return watchPreferences({ goal: get<HTMLSelectElement>('watch-goal').value,
      knownTopics: get<HTMLTextAreaElement>('watch-known').value, budgetMinutes: budget === '' ? null : Number(budget) })
  }

  private async generate(): Promise<void> {
    if (!this.transcript || this.hooks.isBusy()) return
    const transcript = this.transcript, revision = this.hooks.generation()
    const fresh = !!this.plan
    this.hooks.setBusy(true); this.pending = true
    get('error').hidden = true
    get('watch-status').textContent = 'Reading the whole lecture to plan your route…'
    try {
      await this.ready
      if (revision !== this.hooks.generation()) return
      const preferences = this.preferences()
      let saved = true
      try { await chrome.storage.local.set({ [preferenceKey]: preferences }) } catch { saved = false }
      if (revision !== this.hooks.generation()) return
      const event = await this.hooks.request({ id: crypto.randomUUID(), action: 'watch-plan', transcript, preferences, fresh }, revision)
      if (revision !== this.hooks.generation() || transcript !== this.transcript) return
      this.plan = event.result as VideoWatchPlan
      this.render()
      get('watch-status').textContent = `${event.cached ? 'Saved plan' : 'Watch plan ready'} · ${this.plan.model}${saved ? '' : ' · Preferences could not be saved on this device.'}`
    } catch (e) {
      if (revision !== this.hooks.generation()) return
      get('watch-status').textContent = 'Watch plan did not finish. You can retry.'
      this.hooks.error(e instanceof Error ? e.message : String(e))
    } finally {
      if (revision === this.hooks.generation()) { this.pending = false; this.hooks.setBusy(false) }
    }
  }

  private render(): void {
    if (!this.plan || !this.transcript) return
    const plan = this.plan
    get<HTMLDetailsElement>('watch-settings').open = false
    const goals = { understand: 'Understand the theory', implement: 'Put it into practice', review: 'Review what I know' }
    get('watch-settings-summary').textContent = `${goals[plan.preferences.goal]} · ${plan.preferences.budgetMinutes ? `${plan.preferences.budgetMinutes} min available` : 'No time limit'}`
    this.ranges = watchRanges(plan, this.transcript)
    const estimate = watchEstimate(this.ranges)
    get('watch-overview').textContent = plan.overview
    const minutes = Math.ceil(estimate.routeSeconds / 60)
    get('watch-estimate').textContent = `≈${minutes} min route · ${Math.ceil(estimate.focusSeconds / 60)} min focus · ${Math.ceil(this.transcript.duration / 60)} min full video`
    get('watch-estimate').title = 'Focus and visual checks at 1×, skim at 1.5×, skipped sections excluded. Pauses and practice add time. Playback speed is unchanged.'
    const budget = plan.preferences.budgetMinutes
    get('watch-budget-note').hidden = !budget || estimate.routeSeconds <= budget * 60
    get('watch-budget-note').textContent = `This route exceeds your ${budget}-minute budget. Keep the prerequisites and continue in another session.`
    const estimates = element('p', 'Estimate: focus and visual checks at 1×, skim at 1.5×. Pauses and practice add time.', 'meta')
    get('watch-ranges').replaceChildren(estimates, ...this.ranges.map(range => {
      const card = element('article', '', `watch-range watch-${range.recommendation}`)
      const header = element('div', '', 'watch-range-heading')
      const time = element('button', `${clockTime(range.start)}–${clockTime(range.end)}`, 'timestamp')
      time.type = 'button'; time.title = `Jump to ${range.title}`
      time.addEventListener('click', () => void this.seek(range.start))
      header.append(element('span', WATCH_LABELS[range.recommendation], 'watch-badge'), time)
      card.append(header, element('h3', range.title))
      const detail = element('details', '')
      detail.append(element('summary', 'Why this section'))
      detail.append(element('p', range.reason))
      for (const [label, value] of [['Learning target', range.learningTarget], ['Skip only when', range.skipCondition]]) {
        if (!value) continue
        const p = element('p', '')
        p.append(element('strong', `${label}: `), document.createTextNode(value)); detail.append(p)
      }
      if (range.prerequisites.length) {
        const names = range.prerequisites.map(id => plan.sections.find(s => s.firstCaption === id)?.title).filter(Boolean)
        detail.append(element('p', `Before this: ${names.join('; ')}`))
      }
      // Skip conditions must be visible before the viewer decides to jump over content.
      detail.open = range.recommendation === 'skip' || range.recommendation === 'check'
      card.append(detail)
      return card
    }))
    get('watch-result').hidden = false
    get('create-watch-plan').textContent = 'Rebuild watch plan'
  }

  private async seek(seconds: number): Promise<void> {
    const transcript = this.transcript, revision = this.hooks.generation()
    if (!transcript) return
    try {
      const result = await chrome.scripting.executeScript({ target: { tabId: this.tabId },
        func: (videoId: string, time: number) => {
          if (new URL(location.href).searchParams.get('v') !== videoId) return false
          const video = document.querySelector('video')
          if (!video) return false
          video.currentTime = time
          return true
        }, args: [transcript.videoId, seconds] })
      if (revision === this.hooks.generation() && !result[0]?.result) throw new Error('Open the original video before jumping to its watch plan.')
    } catch (e) { if (revision === this.hooks.generation()) this.hooks.error(String(e)) }
  }

  private async nextFocus(): Promise<void> {
    const transcript = this.transcript, revision = this.hooks.generation()
    if (!transcript || !this.plan || this.hooks.isBusy()) return
    try {
      const result = await chrome.scripting.executeScript({ target: { tabId: this.tabId }, func: (videoId: string) => {
        if (new URL(location.href).searchParams.get('v') !== videoId) return null
        return document.querySelector('video')?.currentTime ?? null
      }, args: [transcript.videoId] })
      if (revision !== this.hooks.generation()) return
      const seconds = result[0]?.result
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new Error('Open the original video before jumping to its watch plan.')
      const next = nextFocusRange(this.ranges, seconds)
      if (next) await this.seek(next.start)
      else get('watch-status').textContent = 'No later focus section. Use the timestamps to revisit any section.'
    } catch (e) { if (revision === this.hooks.generation()) this.hooks.error(String(e)) }
  }
}
