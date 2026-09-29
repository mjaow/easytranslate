import { normalizeSegments, parseJsonCaptions, textOf } from './captions.js'
import { advanceTranscript, isVisible, readTranscriptPanel, transcriptPanel } from './transcript-panel.js'
import { requestModernTranscript } from './transcript-request.js'
import type { CaptionSegment, VideoTranscript } from '../src/shared/video.js'

// Bundled as an IIFE and executed in YouTube's MAIN world. This file exposes no
// extension APIs or credentials to the page; its only return value is caption data.
interface Track { baseUrl: string; languageCode: string; kind?: string; name: unknown }
interface PlayerData {
  videoDetails?: { videoId?: string; title?: string; shortDescription?: string; lengthSeconds?: string; isLiveContent?: boolean; isLive?: boolean }
  captions?: { playerCaptionsTracklistRenderer?: {
    captionTracks?: Track[]; defaultAudioTrackIndex?: number;
    audioTracks?: { defaultCaptionTrackIndex?: number }[]
  } }
}
interface Player extends HTMLElement { getPlayerResponse?: () => PlayerData; getDuration?: () => number; getVideoData?: () => { video_id?: string } }
const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function collect(): Promise<{ transcript?: VideoTranscript; error?: string }> {
  const videoId = new URL(location.href).searchParams.get('v')
  if (location.hostname !== 'www.youtube.com' || location.pathname !== '/watch' || !videoId || !/^[\w-]{11}$/.test(videoId)) throw new Error('Open a YouTube video watch page first.')
  const player = document.querySelector<Player>('#movie_player')
  const data = player?.getPlayerResponse?.()
  if (data?.videoDetails?.videoId !== videoId) throw new Error('The video is still loading. Try again in a moment.')
  const duration = Number(data.videoDetails.lengthSeconds || player?.getDuration?.())
  if (!Number.isFinite(duration) || duration <= 0 || data.videoDetails.isLive) throw new Error('Live streams are not supported. Try the recording after captions are available.')
  const meta = { videoId, title: data.videoDetails.title ?? document.title,
    description: typeof data.videoDetails.shortDescription === 'string' ? data.videoDetails.shortDescription : '',
    duration, complete: true as const }
  const assertSameVideo = (): void => {
    if (new URL(location.href).searchParams.get('v') !== videoId || player?.getVideoData?.().video_id && player.getVideoData().video_id !== videoId) throw new Error('The video changed while captions were loading. Click Understand video again.')
  }
  const captionInfo = data.captions?.playerCaptionsTracklistRenderer
  const tracks = captionInfo?.captionTracks ?? []
  const defaultIndex = captionInfo?.audioTracks?.[captionInfo.defaultAudioTrackIndex ?? 0]?.defaultCaptionTrackIndex
  const track = (defaultIndex !== undefined ? tracks[defaultIndex] : undefined) ?? tracks.find(t => t.languageCode === 'en') ?? tracks[0]
  if (track) {
    try {
      const url = new URL(track.baseUrl, location.href)
      if (url.origin === location.origin && url.pathname === '/api/timedtext') {
        url.searchParams.set('fmt', 'json3')
        const response = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(12000) })
        if (response.ok) {
          const body = await response.text()
          let segments: CaptionSegment[] = []
          if (body.trim().startsWith('{')) segments = parseJsonCaptions(JSON.parse(body))
          else if (body.trim().startsWith('<')) {
            const xml = new DOMParser().parseFromString(body, 'text/xml')
            if (!xml.querySelector('parsererror')) segments = normalizeSegments(Array.from(xml.querySelectorAll('text, p')).map(e => {
              const millis = e.tagName === 'p'
              return { start: Number(e.getAttribute(millis ? 't' : 'start')) / (millis ? 1000 : 1),
                duration: Number(e.getAttribute(millis ? 'd' : 'dur') ?? 0) / (millis ? 1000 : 1), text: e.textContent ?? '' }
            }))
          }
          if (segments.length) {
            assertSameVideo()
            return { transcript: { ...meta, source: 'caption-track', language: track.languageCode, automatic: track.kind === 'asr', segments } }
          }
        }
      }
    } catch { /* Empty or unavailable timed text: ask YouTube to load its transcript UI. */ }
  }
  assertSameVideo()
  try {
    const segments = await requestModernTranscript(videoId, assertSameVideo)
    if (segments) return { transcript: { ...meta, source: 'transcript-panel', language: 'YouTube selected track', automatic: false, segments } }
  } catch { /* The native panel can still load if the direct request is unavailable. */ }
  assertSameVideo()
  let panel = transcriptPanel()
  if (!panel) {
    // Expanding the description exposes the native transcript button without a clipboard operation.
    document.querySelector<HTMLElement>('ytd-watch-metadata #description-inline-expander #expand')?.click()
    await pause(300)
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('ytd-video-description-transcript-section-renderer button, ytd-video-description-transcript-section-renderer [role="button"], button[aria-label="Show transcript"]'))
    const button = buttons.find(isVisible)
    if (!button) throw new Error('YouTube did not expose a transcript button. Expand the description, check that Show transcript is available, and retry. No description-based summary was generated.')
    button.click()
  }
  // Allow a long transcript to keep making progress, but stop stalled pagination.
  const started = Date.now()
  const deadline = started + 180000
  let stableSignature = ''
  let stableSince = Date.now()
  let lastProgress = started
  let nextAdvance = 0
  let selectedLanguage: string | undefined
  let status = 'YouTube did not expose caption rows.'
  const collected = new Map<string, CaptionSegment>()
  while (Date.now() < deadline) {
    assertSameVideo()
    panel = transcriptPanel()
    if (panel) {
      const parsed = readTranscriptPanel(panel, videoId)
      if (parsed.videoIdMismatch) throw new Error('YouTube returned transcript rows for a different video. Reload YouTube and retry. These captions were not sent for analysis.')
      if (parsed.filtered) throw new Error('YouTube is showing filtered transcript search results. Clear the search inside Show transcript and retry. Partial captions were not sent for analysis.')
      if (parsed.failed) throw new Error('YouTube could not load its transcript. Use Retry inside Show transcript, then click Understand video again. Partial captions were not sent for analysis.')
      if (parsed.invalidSegments) throw new Error('YouTube returned unreadable caption rows. Reload YouTube and retry. Partial captions were not sent for analysis.')
      if (parsed.language) {
        if (selectedLanguage && selectedLanguage !== parsed.language) throw new Error('The transcript language changed during capture. Click Understand video again.')
        selectedLanguage = parsed.language
      }
      let changed = false
      for (const s of parsed.segments) {
        const key = `${s.start}:${s.text}`
        if (collected.get(key)?.duration !== s.duration) { collected.set(key, s); changed = true }
      }
      if (changed) lastProgress = Date.now()
      const signature = `${collected.size}:${parsed.segments.length}:${parsed.continuation}:${parsed.loading}:${changed}`
      if (signature !== stableSignature) { stableSignature = signature; stableSince = Date.now() }
      if (parsed.continuation && !parsed.loading && Date.now() >= nextAdvance) {
        advanceTranscript(panel, parsed.list)
        nextAdvance = Date.now() + 1000
      }
      if (parsed.hasSegmentList && parsed.segments.length && !parsed.continuation && !parsed.loading && Date.now() - stableSince > 1200) {
        assertSameVideo()
        const language = selectedLanguage || (parsed.modern ? 'YouTube selected track' : textOf(track?.name) || track?.languageCode || 'YouTube selected track')
        return { transcript: { ...meta, source: 'transcript-panel', language, automatic: /auto.generated/i.test(language) || !parsed.modern && track?.kind === 'asr', segments: normalizeSegments([...collected.values()]) } }
      }
      status = parsed.continuation ? 'YouTube still has another transcript page to load.' : parsed.loading ? 'YouTube still reports that the transcript is loading.' : 'YouTube did not expose a complete caption list.'
    }
    if (Date.now() - lastProgress > (collected.size ? 20000 : 45000)) break
    await pause(350)
  }
  const last = [...collected.values()].reduce((end, s) => Math.max(end, s.start + s.duration), 0)
  const time = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(11, 19)
  const detail = collected.size ? ` Read ${collected.size.toLocaleString()} captions through ${time(last)} of ${time(duration)} before stopping.` : ' No caption rows were captured.'
  throw new Error(`YouTube’s complete transcript could not be confirmed. ${status}${detail} Open Show transcript and retry. Partial captions were not sent for analysis.`)
}
// Chrome returns the value of this last expression to the extension.
export default collect().catch(error => ({ error: error instanceof Error ? error.message : String(error) }))
