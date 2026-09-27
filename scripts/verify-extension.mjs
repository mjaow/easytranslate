import { JSDOM } from 'jsdom'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const code = await readFile('out/extension/collector.js', 'utf8')
function page(response, withPanel = false) {
  const dom = new JSDOM(`<div id="movie_player"></div>${withPanel ? '<ytd-transcript-renderer><ytd-transcript-segment-list-renderer></ytd-transcript-segment-list-renderer><ytd-transcript-footer-renderer><button>English (auto-generated)</button></ytd-transcript-footer-renderer></ytd-transcript-renderer>' : ''}`, { url: 'https://www.youtube.com/watch?v=B7yl7fEHeKM', runScripts: 'outside-only' })
  const w = dom.window
  // Advance only the collector's clock so stall/long-pagination cases stay fast.
  let now = 0
  const schedule = w.setTimeout.bind(w)
  w.Date.now = () => now
  w.setTimeout = (callback, ms) => schedule(() => { now += ms; w.onCollectorTick?.(now); callback() }, 0)
  w.AbortSignal = AbortSignal
  w.fetch = async () => ({ ok: true, text: async () => response })
  w.document.getElementById('movie_player').getPlayerResponse = () => ({ videoDetails: { videoId: 'B7yl7fEHeKM', title: 'Interview', lengthSeconds: '3921' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=B7yl7fEHeKM', languageCode: 'en', kind: 'asr' }] } } })
  if (withPanel) {
    const panel = w.document.querySelector('ytd-transcript-renderer')
    panel.getClientRects = () => [{ width: 400 }]
    panel.querySelector('ytd-transcript-segment-list-renderer').data = { initialSegments: [
      { transcriptSegmentRenderer: { startMs: '327000', endMs: '329000', snippet: { runs: [{ text: 'Stagnation is also risky.' }] } } },
      { transcriptSegmentRenderer: { startMs: '3880000', endMs: '3885000', snippet: { runs: [{ text: 'The closing philosophical argument.' }] } } }
    ] }
  }
  return dom
}
let dom = page(JSON.stringify({ events: [{ tStartMs: 327000, dDurationMs: 2000, segs: [{ utf8: 'Stagnation is also risky.' }] }, { tStartMs: 3880000, dDurationMs: 5000, segs: [{ utf8: 'The closing philosophical argument.' }] }] }))
let result = await dom.window.eval(code)
assert.equal(result.transcript.source, 'caption-track'); assert.equal(result.transcript.segments.at(-1).start, 3880); dom.window.close()
console.log('Caption-track capture retains the closing section.')
dom = page('', true); result = await dom.window.eval(code)
assert.equal(result.transcript.source, 'transcript-panel'); assert.equal(result.transcript.segments.length, 2); dom.window.close()
console.log('Empty caption download falls back to full transcript renderer data.')

dom = page('', true)
{
  const list = dom.window.document.querySelector('ytd-transcript-segment-list-renderer')
  list.data.initialSegments.unshift({ transcriptSegmentRenderer: { startMs: '0', endMs: '5560', snippet: {} } })
  list.data.initialSegments.push({ transcriptSegmentRenderer: { startMs: '3910000', endMs: '3921000', snippet: {} } })
  result = await dom.window.eval(code)
  assert.equal(result.transcript?.segments.length, 2, result.error)
  assert.equal(result.transcript.complete, true)
  assert.equal(result.transcript.segments.at(-1).text, 'The closing philosophical argument.')
  dom.window.close()
}
console.log('Legacy blank cues at both ends preserve every spoken caption.')

for (const invalid of [{ startMs: '0', snippet: { unknownText: 'Unrecognized' } }, { startMs: 'invalid', snippet: {} }]) {
  dom = page('', true)
  dom.window.document.querySelector('ytd-transcript-segment-list-renderer').data.initialSegments.push({ transcriptSegmentRenderer: invalid })
  result = await dom.window.eval(code)
  assert.equal(result.transcript, undefined)
  assert.match(result.error, /unreadable caption rows/)
  dom.window.close()
}
console.log('Malformed legacy cues still reject partial caption capture.')
dom = page(''); result = await dom.window.eval(code)
assert.match(result.error, /transcript button/); assert.equal(result.transcript, undefined); dom.window.close()
console.log('Missing captions fail explicitly without using the description.')
dom = page('', true)
const pending = dom.window.eval(code)
dom.window.history.replaceState({}, '', '/watch?v=jNQXAC9IVRw')
result = await pending; assert.match(result.error, /video changed/i); dom.window.close()
console.log('Navigation during capture cannot attach a transcript to the wrong video.')

const segment = (start, text = `Caption at ${start}`) => ({ transcriptSegmentRenderer: { startMs: String(start * 1000), endMs: String((start + 3) * 1000), snippet: { runs: [{ text }] } } })

dom = page('', true)
{
  const panel = dom.window.document.querySelector('ytd-transcript-renderer')
  const list = panel.querySelector('ytd-transcript-segment-list-renderer')
  const full = list.data
  list.data = {} // A stamped placeholder must not hide the populated controller.
  list.polymerController = { data: full }
  const inactive = dom.window.document.createElement('yt-spinner')
  inactive.getClientRects = () => [{ width: 20 }]
  panel.append(inactive)
  result = await dom.window.eval(code)
  assert.equal(result.transcript?.segments.length, 2)
  dom.window.close()
}
console.log('Controller-backed captions and an inactive spinner do not cause false timeouts.')

dom = page('', true)
{
  const panel = dom.window.document.querySelector('ytd-transcript-renderer')
  const list = panel.querySelector('ytd-transcript-segment-list-renderer')
  panel.data = { content: { transcriptSearchPanelRenderer: { body: { transcriptSegmentListRenderer: list.data },
    header: { onTextChangeCommand: { continuationEndpoint: {} } },
    footer: { languageMenu: { continuations: [{ reloadContinuationData: { continuation: 'switch-language' } }] } }
  } } }
  list.data = {}
  result = await dom.window.eval(code)
  assert.equal(result.transcript?.segments.length, 2)
  dom.window.close()
}
console.log('A populated parent body is readable without treating search/language commands as pagination.')

dom = page('', true)
{
  const w = dom.window
  w.history.replaceState({}, '', '/watch?v=B7yl7fEHeKM&t=17364s')
  const player = w.document.getElementById('movie_player')
  const data = player.getPlayerResponse()
  data.videoDetails.lengthSeconds = '18900'
  player.getPlayerResponse = () => data
  const panel = w.document.querySelector('ytd-transcript-renderer')
  const list = panel.querySelector('ytd-transcript-segment-list-renderer')
  const viewport = w.document.createElement('div')
  viewport.style.overflowY = 'auto'
  Object.defineProperties(viewport, { scrollHeight: { value: 40000 }, clientHeight: { value: 500 } })
  list.replaceWith(viewport)
  viewport.append(list)
  list.innerHTML = '<div id="segments-container"></div>'
  let current = 0
  let readyAt
  const pages = Array.from({ length: 7 }, (_, p) => ({ initialSegments: [
    ...Array.from({ length: 900 }, (_, i) => segment((p * 900 + i) * 3)),
    ...(p < 6 ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: `page-${p + 1}` } } } }] : [])
  ] }))
  list.data = pages[0]
  viewport.addEventListener('scroll', () => {
    if (readyAt !== undefined || current === 6) return
    readyAt = w.Date.now() + 10000
    panel.isLoadingTranscripts = true
    list.data = {} // YouTube replaces data while a page loads.
  })
  w.onCollectorTick = now => {
    if (readyAt !== undefined && now >= readyAt) {
      list.data = pages[++current]
      panel.isLoadingTranscripts = false
      readyAt = undefined
    }
  }
  result = await w.eval(code)
  assert.equal(result.transcript?.segments.length, 6300, result.error)
  assert.equal(result.transcript.segments[0].start, 0)
  assert.equal(result.transcript.segments.at(-1).start, 18897)
  assert.equal(result.transcript.complete, true)
  assert.ok(w.Date.now() > 45000, 'Progressing capture should outlive the old 45-second limit')
  dom.window.close()
}
console.log('A 5h15m transcript loads all 6,300 captions across seven replaced pages using the real ancestor viewport.')

dom = page('', true)
{
  const list = dom.window.document.querySelector('ytd-transcript-segment-list-renderer')
  list.data.initialSegments.push({ continuationItemRenderer: { continuationEndpoint: {} } })
  result = await dom.window.eval(code)
  assert.equal(result.transcript, undefined)
  assert.match(result.error, /another transcript page/)
  assert.match(result.error, /Read 2 captions through/)
  dom.window.close()
}
console.log('Stalled pagination rejects partial captions and reports where collection stopped.')

dom = page('', true)
{
  const list = dom.window.document.querySelector('ytd-transcript-segment-list-renderer')
  list.data = { searchResultSegments: [segment(17364)] }
  result = await dom.window.eval(code)
  assert.equal(result.transcript, undefined)
  assert.match(result.error, /filtered transcript search results/)
  dom.window.close()
}
console.log('Filtered search results cannot be mistaken for the whole transcript.')

dom = page('', true)
dom.window.onCollectorTick = () => { dom.window.document.querySelector('ytd-transcript-footer-renderer button').textContent = 'Spanish' }
result = await dom.window.eval(code)
assert.equal(result.transcript, undefined)
assert.match(result.error, /language changed/)
dom.window.close()
console.log('Language switches cannot mix two caption tracks during capture.')

// Schema taken from YouTube's PAmodern_transcript_view get_panel response for
// NYFGCESmikA (2026-09-26). Text is shortened; wrappers and timestamps are retained.
const modernMarker = (timestamp, text, videoId = 'B7yl7fEHeKM') => ({ macroMarkersPanelItemViewModel: {
  item: { timelineItemViewModel: { timestamp, contentItems: [{ transcriptSegmentViewModel: { simpleText: text, timestamp } }] } },
  panelId: 'PAmodern_transcript_view', onTap: { innertubeCommand: { watchEndpoint: { videoId } } }
} })
const modernList = () => ({ targetId: 'PAmodern_transcript_view', contents: [
  { itemSectionRenderer: { header: { title: 'Do not summarize chapter labels' }, contents: [modernMarker('0:00', 'Opening argument.')] } },
  { itemSectionRenderer: { contents: [modernMarker('5:15:31', 'Closing qualification.')] } }
], header: { searchInputViewModel: { onInputAction: { command: { innertubeCommand: { continuationCommand: { token: 'search-only', request: 'CONTINUATION_REQUEST_TYPE_GET_PANEL' } } } } } } })
function modernPage(body) {
  const dom = page('')
  const w = dom.window
  const player = w.document.getElementById('movie_player'), data = player.getPlayerResponse()
  data.videoDetails.lengthSeconds = '18951'
  player.getPlayerResponse = () => data
  w.ytInitialData = { currentVideoEndpoint: { watchEndpoint: { videoId: 'B7yl7fEHeKM' } }, engagementPanels: [{
    engagementPanelSectionListRenderer: { header: { chipBarViewModel: { chips: [{ chipViewModel: { tapCommand: { innertubeCommand: {
      updateEngagementPanelContentCommand: { contentSourcePanelIdentifier: { tag: 'PAmodern_transcript_view' }, globalConfiguration: { params: 'from-current-watch-page' } }
    } } } }] } } }
  }] }
  w.ytcfg = { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'fixture' } }, INNERTUBE_CONTEXT_CLIENT_NAME: 1 })[key] }
  w.panelRequests = 0
  w.fetch = async (url, options) => {
    if (String(url).includes('/api/timedtext')) return { ok: true, text: async () => '' }
    assert.equal(url, '/youtubei/v1/get_panel?prettyPrint=false')
    assert.equal(options.credentials, 'same-origin')
    const request = JSON.parse(options.body)
    assert.equal(request.panelId, 'PAmodern_transcript_view')
    assert.equal(request.params, 'from-current-watch-page')
    assert.equal(request.formData, undefined, 'Do not request filtered search results')
    w.panelRequests++
    return { ok: true, json: async () => body }
  }
  return dom
}
const modernBody = list => ({ content: { engagementPanelSectionListRenderer: { identifier: { tag: 'PAmodern_transcript_view' }, content: { sectionListRenderer: list } } } })

dom = modernPage(modernBody(modernList()))
result = await dom.window.eval(code)
assert.equal(result.transcript?.segments.length, 2, result.error)
assert.equal(result.transcript.segments.at(-1).start, 18931)
assert.equal(result.transcript.language, 'YouTube selected track', 'Do not invent language metadata absent from the payload')
assert.equal(dom.window.panelRequests, 1)
dom.window.close()
console.log('Modern transcript payload loads directly with hour timestamps and without the legacy renderer.')

// Stanford CS329A (6YnLB0XbTnI) ends with a timestamp-only cue at 1:09:37.
// Exercise both capture routes, including the native-panel path that used to fail.
for (const source of ['request', 'panel']) {
  const list = modernList()
  const blank = modernMarker('1:09:37', undefined)
  delete blank.macroMarkersPanelItemViewModel.item.timelineItemViewModel.contentItems[0].transcriptSegmentViewModel.simpleText
  list.contents = [{ itemSectionRenderer: { contents: [
    modernMarker('0:00', 'Welcome, everyone, to fall quarter and welcome to CS329A.'),
    modernMarker('1:09:28', 'No? All right. OK. Thanks, everyone.'), blank
  ] } }]
  dom = source === 'request' ? modernPage(modernBody(list)) : page('')
  const player = dom.window.document.getElementById('movie_player'), data = player.getPlayerResponse()
  data.videoDetails.lengthSeconds = '4182'
  player.getPlayerResponse = () => data
  if (source === 'panel') {
    const panel = dom.window.document.createElement('ytd-engagement-panel-section-list-renderer')
    panel.getClientRects = () => [{ width: 400 }]
    panel.data = { content: { sectionListRenderer: list } }
    dom.window.document.body.append(panel)
  }
  result = await dom.window.eval(code)
  assert.equal(result.transcript?.segments.length, 2, result.error)
  assert.equal(result.transcript.complete, true)
  assert.equal(result.transcript.segments.at(-1).text, 'No? All right. OK. Thanks, everyone.')
  assert.equal(result.transcript.segments.at(-1).start, 4168)
  dom.window.close()
}
console.log('Timestamp-only blank cues preserve all spoken captions in direct and native modern capture.')

for (const failure of ['next-page', 'wrong-video', 'stale-watch-data', 'unknown-panel']) {
  const list = modernList()
  if (failure === 'next-page') list.contents.push({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'more-captions' } } } })
  if (failure === 'wrong-video') list.contents[1].itemSectionRenderer.contents = [modernMarker('5:15:31', 'Wrong video.', 'jNQXAC9IVRw')]
  if (failure === 'unknown-panel') list.targetId = 'PAtimeline_view'
  dom = modernPage(modernBody(list))
  if (failure === 'stale-watch-data') dom.window.ytInitialData.currentVideoEndpoint.watchEndpoint.videoId = 'jNQXAC9IVRw'
  result = await dom.window.eval(code)
  assert.equal(result.transcript, undefined, failure)
  if (failure === 'stale-watch-data') assert.equal(dom.window.panelRequests, 0)
  dom.window.close()
}
console.log('Partial modern payloads, wrong-video rows, stale watch data and non-transcript timelines are rejected.')

dom = page('')
{
  const panel = dom.window.document.createElement('ytd-engagement-panel-section-list-renderer')
  panel.getClientRects = () => [{ width: 400 }]
  panel.data = { content: { sectionListRenderer: modernList() } }
  panel.innerHTML = '<ytd-section-list-renderer></ytd-section-list-renderer>'
  dom.window.document.body.append(panel)
  result = await dom.window.eval(code)
  assert.equal(result.transcript?.segments.length, 2, result.error)
  panel.innerHTML += '<input value="filtered query">'
  result = await dom.window.eval(code)
  assert.equal(result.transcript, undefined)
  assert.match(result.error, /filtered transcript search results/)
  dom.window.close()
}
console.log('The native modern panel is supported too; its search results remain excluded.')
