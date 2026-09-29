import type { VideoTranscript, VideoWatchPlan, WatchSection } from './video.js'

export const WATCH_LABELS = { focus: 'Focus', skim: 'Skim', skip: 'Skip', check: 'Check visuals' } as const
export interface WatchRange extends WatchSection { start: number; end: number }
const GAP_SECONDS = 15

/** Times come from captions, never model-generated seconds. Uncaptioned gaps stay visible. */
export function watchRanges(plan: VideoWatchPlan, transcript: VideoTranscript): WatchRange[] {
  const ranges: WatchRange[] = []
  let cursor = 0
  const gap = (end: number): void => {
    if (end <= cursor) return
    ranges.push({ start: cursor, end, firstCaption: 0, lastCaption: 0, title: 'Uncaptioned interval',
      recommendation: 'check', reason: 'The captions do not describe this interval. Check for slides, equations, or a demonstration.',
      learningTarget: '', skipCondition: '', prerequisites: [] })
    cursor = end
  }
  for (const section of plan.sections) {
    let start = Math.min(transcript.duration, transcript.segments[section.firstCaption - 1].start)
    let end = start
    if (start - cursor > GAP_SECONDS) gap(start)
    else start = cursor
    for (let i = section.firstCaption - 1; i < section.lastCaption; i++) {
      const cue = transcript.segments[i]
      const cueStart = Math.min(cue.start, transcript.duration)
      if (cueStart - end > GAP_SECONDS && i > section.firstCaption - 1) {
        if (end > start) ranges.push({ ...section, start, end })
        cursor = end; gap(cueStart); start = cueStart
      }
      // Adjacent captions may overlap. Never extend a range into the next section.
      const nextSectionStart = transcript.segments[section.lastCaption]?.start ?? transcript.duration
      end = Math.min(transcript.duration, nextSectionStart, Math.max(end, cue.start + cue.duration))
    }
    const next = Math.min(transcript.duration, transcript.segments[section.lastCaption]?.start ?? transcript.duration)
    if (next - end <= GAP_SECONDS) end = next
    if (end > start) ranges.push({ ...section, start, end })
    cursor = end
  }
  gap(transcript.duration)
  return ranges
}

export function watchEstimate(ranges: WatchRange[]): { focusSeconds: number; routeSeconds: number; checkSeconds: number } {
  const seconds = (kind: WatchSection['recommendation']): number => ranges.filter(r => r.recommendation === kind).reduce((n, r) => n + r.end - r.start, 0)
  // Skim at 1.5x is an estimate, not a command to change playback speed.
  return { focusSeconds: seconds('focus'), checkSeconds: seconds('check'), routeSeconds: seconds('focus') + seconds('skim') / 1.5 + seconds('check') }
}

export function nextFocusRange(ranges: WatchRange[], seconds: number): WatchRange | undefined {
  return ranges.find(r => r.recommendation === 'focus' && r.start > seconds + 0.5)
}
