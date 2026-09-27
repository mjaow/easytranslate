import { MODERN_TRANSCRIPT_PANEL, parseTranscriptData } from './captions.js'
import type { CaptionSegment } from '../src/shared/video.js'

interface WatchData {
  currentVideoEndpoint?: { watchEndpoint?: { videoId?: string } }
  engagementPanels?: unknown[]
}
interface PageGlobals {
  ytInitialData?: WatchData
  ytcfg?: { get: (key: string) => unknown }
}
interface WatchElement extends HTMLElement { data?: WatchData; polymerController?: { data?: WatchData } }

/** Use only the transcript command supplied on the current video's watch page. */
export function modernTranscriptRequest(data: WatchData | undefined, videoId: string): { panelId: string; params: string } | undefined {
  if (data?.currentVideoEndpoint?.watchEndpoint?.videoId !== videoId) return
  const seen = new WeakSet<object>()
  const find = (node: unknown, depth: number): string | undefined => {
    if (!node || typeof node !== 'object' || depth > 25 || seen.has(node)) return
    seen.add(node)
    const obj = node as Record<string, unknown>
    const command = obj.updateEngagementPanelContentCommand as { contentSourcePanelIdentifier?: { tag?: string }; globalConfiguration?: { params?: string } } | undefined
    if (command?.contentSourcePanelIdentifier?.tag === MODERN_TRANSCRIPT_PANEL && typeof command.globalConfiguration?.params === 'string') return command.globalConfiguration.params
    for (const child of Object.values(obj)) { const params = find(child, depth + 1); if (params) return params }
  }
  const params = find(data.engagementPanels, 0)
  return params ? { panelId: MODERN_TRANSCRIPT_PANEL, params } : undefined
}

/** Fetch the same complete transcript payload that YouTube's new panel uses. */
export async function requestModernTranscript(videoId: string, assertSameVideo: () => void): Promise<CaptionSegment[] | undefined> {
  const page = window as unknown as PageGlobals
  const watch = document.querySelector<WatchElement>('ytd-watch-flexy')
  const request = [watch?.data, watch?.polymerController?.data, page.ytInitialData]
    .map(data => modernTranscriptRequest(data, videoId)).find(Boolean)
  const config = page.ytcfg
  const context = config?.get('INNERTUBE_CONTEXT') as { client?: { clientVersion?: string } } | undefined
  if (!request || !context?.client) return
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const clientName = config?.get('INNERTUBE_CONTEXT_CLIENT_NAME')
  const clientVersion = context.client.clientVersion
  if (typeof clientName === 'number' || typeof clientName === 'string') headers['x-youtube-client-name'] = String(clientName)
  if (clientVersion) headers['x-youtube-client-version'] = clientVersion
  // No cookie/key extraction or third-party transcript service. Page credentials
  // remain in the browser and are sent only to YouTube's same-origin endpoint.
  assertSameVideo()
  const response = await fetch('/youtubei/v1/get_panel?prettyPrint=false', {
    method: 'POST', credentials: 'same-origin', headers,
    body: JSON.stringify({ context, ...request }), signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) return
  const body = await response.json() as { content?: { engagementPanelSectionListRenderer?: { identifier?: { tag?: string }; content?: unknown } }; updatePanelContinuationData?: unknown }
  assertSameVideo()
  const panel = body.content?.engagementPanelSectionListRenderer
  if (panel?.identifier?.tag !== MODERN_TRANSCRIPT_PANEL) return
  const parsed = parseTranscriptData(panel.content, videoId)
  // A paginated/unknown response falls back to the native panel; never label a
  // single unfinished page as the full transcript.
  if (!parsed.modern || !parsed.hasSegmentList || !parsed.segments.length || parsed.continuation || parsed.filtered || parsed.invalidSegments || parsed.videoIdMismatch || body.updatePanelContinuationData) return
  return parsed.segments
}
