import type { CaptionSegment } from '../src/shared/video.js'

export function textOf(value: unknown): string {
  const v = value as { simpleText?: string; runs?: { text?: string }[] }
  if (typeof value === 'string') return value
  return v?.simpleText ?? v?.runs?.map(r => r.text ?? '').join('') ?? ''
}
export function normalizeSegments(segments: CaptionSegment[]): CaptionSegment[] {
  const seen = new Set<string>()
  return segments.map(s => ({ ...s, text: s.text.replace(/\s+/g, ' ').trim() }))
    .filter(s => {
      const key = `${s.start}:${s.text}`
      if (!s.text || !Number.isFinite(s.start) || s.start < 0 || !Number.isFinite(s.duration) || s.duration < 0 || seen.has(key)) return false
      seen.add(key); return true
    }).sort((a, b) => a.start - b.start)
}
export function parseJsonCaptions(value: unknown): CaptionSegment[] {
  const v = value as { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[] }
  return normalizeSegments((v?.events ?? []).filter(e => e.segs?.length).map(e => ({
    start: Number(e.tStartMs) / 1000, duration: Number(e.dDurationMs ?? 0) / 1000,
    text: e.segs!.map(s => s.utf8 ?? '').join('')
  })))
}
export interface ParsedTranscript {
  segments: CaptionSegment[]
  continuation: boolean
  hasSegmentList: boolean
  filtered: boolean
  invalidSegments: number
  modern: boolean
  videoIdMismatch: boolean
}
export const MODERN_TRANSCRIPT_PANEL = 'PAmodern_transcript_view'

function timestampSeconds(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+:\d{2}(?::\d{2})?$/.test(value)) return NaN
  const parts = value.split(':').map(Number)
  if (parts.slice(1).some(n => n >= 60)) return NaN
  return parts.reduce((total, n) => total * 60 + n, 0)
}
/** Read caption bodies, not commands in the search box or language menu. */
export function parseTranscriptData(root: unknown, expectedVideoId?: string): ParsedTranscript {
  const segments: CaptionSegment[] = []
  let continuation = false
  let hasSegmentList = false
  let filtered = false
  let invalidSegments = 0
  let modern = false
  let videoIdMismatch = false
  const seen = new WeakSet<object>()
  const walk = (node: unknown, depth: number, inModernBody = false, markerVideoId?: string): void => {
    if (!node || typeof node !== 'object' || depth > 30 || seen.has(node)) return
    seen.add(node)
    const obj = node as Record<string, unknown>
    // The new "In this video" UI uses a section list of timeline items. Only
    // its dedicated transcript body is evidence; the Timeline tab is not.
    if (obj.targetId === MODERN_TRANSCRIPT_PANEL && Array.isArray(obj.contents)) {
      inModernBody = true
      modern = true
      hasSegmentList = true
    }
    const marker = obj.macroMarkersPanelItemViewModel as { item?: unknown; onTap?: { innertubeCommand?: { watchEndpoint?: { videoId?: string } } } } | undefined
    if (inModernBody && marker) {
      walk(marker.item, depth + 1, true, marker.onTap?.innertubeCommand?.watchEndpoint?.videoId)
      return
    }
    const view = obj.transcriptSegmentViewModel as { simpleText?: string; attributedText?: { content?: string }; timestamp?: string } | undefined
    if (inModernBody && view) {
      const start = timestampSeconds(view.timestamp)
      const text = view.attributedText?.content ?? view.simpleText ?? ''
      if (expectedVideoId && markerVideoId !== expectedVideoId) videoIdMismatch = true
      if (!Number.isFinite(start) || start < 0 || typeof text !== 'string' || !text.trim()) invalidSegments++
      // This format supplies a start timestamp, not an end time.
      else segments.push({ start, duration: 0, text })
      return
    }
    // Search results are a subset, even when they have no continuation.
    if (Array.isArray(obj.searchResultSegments)) { filtered = true; return }
    if (Array.isArray(obj.initialSegments)) hasSegmentList = true
    const s = obj.transcriptSegmentRenderer as { startMs: string; endMs?: string; snippet: unknown } | undefined
    if (s) {
      const start = Number(s.startMs) / 1000
      const end = Number(s.endMs ?? s.startMs) / 1000
      const text = textOf(s.snippet)
      if (s.startMs == null || !Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end < start || !text.trim()) invalidSegments++
      else segments.push({ start, duration: end - start, text })
      // A caption's seek/menu commands do not paginate the transcript.
      return
    }
    if (obj.continuationItemRenderer || obj.continuationEndpoint || inModernBody && obj.continuationCommand || (Array.isArray(obj.continuations) && obj.continuations.length)) continuation = true
    // YouTube retains reload continuations for changing language/search after
    // the complete initialSegments array has loaded. They are not more captions.
    for (const [key, child] of Object.entries(obj)) {
      if (['header', 'footer', 'languageMenu', 'trackingParams', 'onTextChangeCommand', 'navigationEndpoint', 'commandMetadata'].includes(key)) continue
      walk(child, depth + 1, inModernBody, markerVideoId)
    }
  }
  walk(root, 0)
  return { segments: normalizeSegments(segments), continuation, hasSegmentList, filtered, invalidSegments, modern, videoIdMismatch }
}
