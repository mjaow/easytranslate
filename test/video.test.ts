import { describe, it, expect } from 'vitest'
import { batchJsonValues, chunkCaptions, parseIdeas, parseSummary, sourcesField, validateTranscript } from '../src/core/video.js'
import { VideoEventReader, videoPackets } from '../src/shared/video-wire.js'
import { NativeDecoder, encodeNative } from '../src/core/native-protocol.js'
import { parseJsonCaptions, parseTranscriptData } from '../extension/captions.js'
import type { VideoTranscript } from '../src/shared/video.js'

const transcript: VideoTranscript = { videoId: 'B7yl7fEHeKM', title: 'Interview', language: 'en', automatic: true, duration: 3921, source: 'caption-track', complete: true,
  segments: [{ start: 327, duration: 5, text: 'Stagnation is also risky.' }, { start: 440, duration: 6, text: 'Enforcement would require global government.' }] }

describe('video evidence boundaries', () => {
  it('rejects partial, unordered and oversized transcripts instead of truncating', () => {
    expect(validateTranscript(transcript)).toEqual(transcript)
    expect(() => validateTranscript({ ...transcript, complete: false })).toThrow()
    expect(() => validateTranscript({ ...transcript, segments: [...transcript.segments].reverse() })).toThrow()
    expect(() => validateTranscript({ ...transcript, segments: [{ start: 0, duration: 1, text: 'x'.repeat(600001) }] })).toThrow()
  })
  it('covers every caption including the end across many chunks', () => {
    const segments = Array.from({ length: 1300 }, (_, i) => ({ start: i * 3, duration: 3, text: `Position number ${i}: ${'evidence '.repeat(20)}` }))
    const chunks = chunkCaptions(segments, 800)
    expect(chunks[0].first).toBe(1)
    expect(chunks.at(-1)!.last).toBe(1300)
    expect(chunks.at(-1)!.text).toContain('Position number 1299')
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].first).toBe(chunks[i - 1].last + 1)
  })
  it('rejects invented timestamps/IDs and unsupported ideas', () => {
    expect(() => sourcesField([0, 3], 1, 2)).toThrow()
    expect(() => parseIdeas({ ideas: [{ title: 'Claim', claim: 'x', reasoning: 'x', example: '', caveat: '', sources: [] }], unanswered: [] }, { first: 1, last: 2, text: '' })).toThrow()
  })
  it('accepts more than twenty valid references without confusing count with invalid evidence', () => {
    const ids = Array.from({ length: 35 }, (_, i) => i + 301)
    expect(sourcesField(ids, 301, 605)).toEqual(ids)
    expect(() => sourcesField([1, 301], 301, 605)).toThrow(/1 outside.*301–605/)
    expect(() => sourcesField(['301'], 301, 605)).toThrow(/integer IDs/)
  })
  it('requires a summary and caps the breakdown at eight grouped themes', () => {
    const chunk = chunkCaptions(transcript.segments)[0]
    const idea = { title: 'Progress', claim: 'Stagnation is risky.', reasoning: 'Not provided.', example: '', caveat: '', sources: [1] }
    const summary = { overview: 'Stagnation has risks too.', takeaways: [{ text: 'Stagnation is also risky.', sources: [1] }], connections: '', ideas: [idea], evaluation: [], unanswered: [] }
    expect(parseSummary(summary, chunk).overview).toBe(summary.overview)
    expect(() => parseSummary({ ...summary, overview: '' }, chunk)).toThrow(/readable overview/)
    expect(() => parseSummary({ ...summary, ideas: Array(9).fill(idea) }, chunk)).toThrow(/at most 8/)
    expect(() => parseSummary({ ...summary, takeaways: [] }, chunk)).toThrow(/takeaways/)
    expect(() => parseSummary({ ...summary, takeaways: [{ text: 'Unsupported.', sources: [999] }] }, chunk)).toThrow(/outside/)
    expect(() => parseSummary({ ...summary, takeaways: [{ text: 'Unsupported.', sources: [] }] }, chunk)).toThrow(/supporting captions/)
  })
  it('keeps the model assessment separate and requires references to the argument being assessed', () => {
    const chunk = chunkCaptions(transcript.segments)[0]
    const item = { claim: 'Stagnation has risks.', support: 'The speaker asserts this.', limits: 'No comparison is given.', test: '', sources: [1] }
    const summary = { overview: 'Stagnation has risks too.', takeaways: [{ text: 'Stagnation is also risky.', sources: [1] }], connections: '', ideas: [], evaluation: [item], unanswered: [] }
    expect(parseSummary(summary, chunk).evaluation).toEqual([item])
    expect(parseSummary(summary, chunk).ideas).toEqual([])
    expect(() => parseSummary({ ...summary, evaluation: undefined }, chunk)).toThrow(/assessment array/)
    expect(() => parseSummary({ ...summary, evaluation: Array(4).fill(item) }, chunk)).toThrow(/at most 3/)
    expect(() => parseSummary({ ...summary, evaluation: [{ ...item, sources: [3] }] }, chunk)).toThrow(/outside/)
    expect(() => parseSummary({ ...summary, evaluation: [{ ...item, sources: [] }] }, chunk)).toThrow(/relevant captions/)
    expect(() => parseSummary({ ...summary, evaluation: [{ ...item, support: '' }] }, chunk)).toThrow(/evidence assessment/)
    expect(parseSummary({ ...summary, evaluation: [{ ...item, limits: '', test: '' }] }, chunk).evaluation[0].limits).toBe('')
    const optional = parseSummary({ ...summary, connections: null, evaluation: [{ ...item, limits: null, test: undefined }],
      ideas: [{ title: 'Stagnation', claim: 'Stagnation has risks.', reasoning: null, sources: [1] }] }, chunk)
    expect(optional.evaluation[0]).toMatchObject({ limits: '', test: '' })
    expect(optional.ideas[0]).toMatchObject({ reasoning: '', example: '', caveat: '' })
    expect(optional.connections).toBe('')
    expect(() => parseSummary({ ...summary, evaluation: [{ ...item, limits: ['invalid'] }] }, chunk)).toThrow(/assessment limits/)
    expect(() => parseSummary({ ...summary, evaluation: [{ ...item, support: null }] }, chunk)).toThrow(/assessment support/)
  })
  it('accepts the cited unanswered questions returned for the Stanford video as plain text', () => {
    const chunk = { first: 1, last: 613, text: '' }
    // Captured gpt-6-luna response for 6YnLB0XbTnI, 2026-09-26.
    const question = 'How does the latency compare with generating many samples versus using a larger model?'
    const summary = { overview: 'Repeated sampling can improve success.', takeaways: [{ text: 'More samples can improve success.', sources: [226] }],
      connections: '', ideas: [], evaluation: [], unanswered: [{ question, sources: [226, 228, 230, 231] }, 'How should repeated sampling be handled when there is no verifier?'] }
    expect(parseSummary(summary, chunk).unanswered).toEqual([question, summary.unanswered[1]])
    expect(() => parseSummary({ ...summary, unanswered: [{ question, sources: [614] }] }, chunk)).toThrow(/outside/)
    expect(() => parseSummary({ ...summary, unanswered: [{ question, sources: ['226'] }] }, chunk)).toThrow(/integer IDs/)
    expect(() => parseSummary({ ...summary, unanswered: [{ question, sources: [] }] }, chunk)).toThrow(/supporting captions/)
    expect(() => parseSummary({ ...summary, unanswered: [{ question }] }, chunk)).toThrow(/integer IDs/)
  })
  it.each([null, 42, [], {}, { question: null, sources: [1] }, { text: 'Wrong field', sources: [1] }, '', '   ', 'x'.repeat(2001),
    { question: 'x'.repeat(2001), sources: [1] }])('identifies invalid unanswered question text without discarding it (case %#)', question => {
    expect(() => parseIdeas({ ideas: [], unanswered: [question] }, { first: 1, last: 2, text: '' })).toThrow(/unanswered question/)
  })
})
describe('caption collector parsing', () => {
  it('keeps timestamps, Unicode and separate statements; drops empty paint events', () => {
    expect(parseJsonCaptions({ events: [{ tStartMs: 0 }, { tStartMs: 327000, dDurationMs: 2000, segs: [{ utf8: 'AI ' }, { utf8: '风险' }] }] })).toEqual([{ start: 327, duration: 2, text: 'AI 风险' }])
  })
  it('extracts only transcript segments, including data for virtualized rows, and detects continuations', () => {
    const result = parseTranscriptData({ contents: [
      { transcriptSegmentRenderer: { startMs: '1000', endMs: '2500', snippet: { runs: [{ text: 'Evidence' }] } } },
      { description: { runs: [{ text: 'Do not summarize this description' }] } },
      { continuationItemRenderer: { continuationEndpoint: {} } }
    ] })
    expect(result.segments).toEqual([{ start: 1, duration: 1.5, text: 'Evidence' }])
    expect(result.continuation).toBe(true)
  })
  it('distinguishes full caption bodies from search results and language/search reload commands', () => {
    const segment = { transcriptSegmentRenderer: { startMs: '17364000', endMs: '17367000', snippet: { simpleText: 'Long video evidence' }, navigationEndpoint: { continuationEndpoint: {} } } }
    const result = parseTranscriptData({ content: { transcriptSearchPanelRenderer: {
      header: { onTextChangeCommand: { continuationEndpoint: {} } },
      body: { transcriptSegmentListRenderer: { initialSegments: [segment] } },
      footer: { languageMenu: { continuations: [{ reloadContinuationData: {} }] } }
    } } })
    expect(result).toMatchObject({ hasSegmentList: true, continuation: false, filtered: false, invalidSegments: 0 })
    expect(result.segments[0].start).toBe(17364)
    expect(parseTranscriptData({ searchResultSegments: [segment] })).toMatchObject({ filtered: true, hasSegmentList: false, segments: [] })
  })
  it('reports unreadable caption rows instead of silently treating remaining rows as complete', () => {
    expect(parseTranscriptData({ initialSegments: [{ transcriptSegmentRenderer: { snippet: { simpleText: 'Missing timestamp' } } }] })).toMatchObject({ hasSegmentList: true, invalidSegments: 1, segments: [] })
  })
  it('skips empty legacy caption cues at the beginning and end of the live Stanford transcript', () => {
    // Live Edge panel, 6YnLB0XbTnI, 2026-09-26: a newer-looking panel can
    // still expose transcriptSegmentRenderer rows with empty snippet objects.
    const parsed = parseTranscriptData({ initialSegments: [
      { transcriptSegmentRenderer: { startMs: '0', endMs: '5560', snippet: {} } },
      { transcriptSegmentRenderer: { startMs: '5560', endMs: '10320', snippet: { runs: [{ text: 'Welcome, everyone.' }] } } },
      { transcriptSegmentRenderer: { startMs: '4168000', endMs: '4177720', snippet: { simpleText: 'Thanks, everyone.' } } },
      { transcriptSegmentRenderer: { startMs: '4177720', endMs: '4182000', snippet: {} } }
    ] })
    expect(parsed).toMatchObject({ hasSegmentList: true, modern: false, invalidSegments: 0 })
    expect(parsed.segments).toMatchObject([
      { start: 5.56, text: 'Welcome, everyone.' },
      { start: 4168, text: 'Thanks, everyone.' }
    ])
    expect(parsed.segments[0].duration).toBeCloseTo(4.76)
    expect(parsed.segments[1].duration).toBeCloseTo(9.72)
  })
  it.each([
    { startMs: '0', endMs: '1000', snippet: { simpleText: '' } },
    { startMs: '0', endMs: '1000', snippet: { runs: [{ text: ' \n ' }] } }
  ])('skips readable empty legacy text: %j', row => {
    expect(parseTranscriptData({ initialSegments: [{ transcriptSegmentRenderer: row }] })).toMatchObject({ invalidSegments: 0, segments: [] })
  })
  it.each([
    { startMs: 'bad', snippet: {} },
    { startMs: '1000', endMs: '0', snippet: {} },
    { startMs: '0' },
    { startMs: '0', snippet: { content: 'Unsupported text representation' } },
    { startMs: '0', snippet: { runs: [{ text: 42 }] } },
    { startMs: '0', snippet: { runs: [{ text: 'Readable' }, { unexpected: 'Must not lose this' }] } }
  ])('rejects malformed legacy cues instead of discarding their text: %j', row => {
    expect(parseTranscriptData({ initialSegments: [{ transcriptSegmentRenderer: row }] })).toMatchObject({ invalidSegments: 1, segments: [] })
  })
  it('reads the modern transcript body and hour timestamps, excluding other timelines', () => {
    const list = { targetId: 'PAmodern_transcript_view', contents: [{ macroMarkersPanelItemViewModel: {
      onTap: { innertubeCommand: { watchEndpoint: { videoId: 'NYFGCESmikA' } } },
      item: { timelineItemViewModel: { contentItems: [{ transcriptSegmentViewModel: { timestamp: '5:15:31', attributedText: { content: 'Closing argument.' } } }] } }
    } }], header: { searchInputViewModel: { continuationCommand: { token: 'search' } } } }
    const parsed = parseTranscriptData(list, 'NYFGCESmikA')
    expect(parsed).toMatchObject({ hasSegmentList: true, modern: true, continuation: false, videoIdMismatch: false, invalidSegments: 0 })
    expect(parsed.segments).toEqual([{ start: 18931, duration: 0, text: 'Closing argument.' }])
    expect(parseTranscriptData(list, 'jNQXAC9IVRw').videoIdMismatch).toBe(true)
    expect(parseTranscriptData({ ...list, targetId: 'PAtimeline_view' }).segments).toEqual([])
    const view = list.contents[0].macroMarkersPanelItemViewModel.item.timelineItemViewModel.contentItems[0].transcriptSegmentViewModel
    view.timestamp = '5:75:31'
    expect(parseTranscriptData(list).invalidSegments).toBe(1)
  })
  it('accepts the timestamp-only ending cue in the Stanford CS329A transcript', () => {
    // 6YnLB0XbTnI get_panel response, 2026-09-26: the final row at 1:09:37
    // has a timestamp but no simpleText, attributedText or textUtf16Length.
    const views = [
      { timestamp: '0:00', simpleText: 'Welcome, everyone, to fall quarter and welcome to CS329A.' },
      { timestamp: '1:09:28', simpleText: 'No? All right. OK. Thanks, everyone.' },
      { timestamp: '1:09:37', timestampUtf16Length: 7 }
    ]
    const list = { targetId: 'PAmodern_transcript_view', contents: views.map(view => ({ macroMarkersPanelItemViewModel: {
      onTap: { innertubeCommand: { watchEndpoint: { videoId: '6YnLB0XbTnI' } } },
      item: { timelineItemViewModel: { contentItems: [{ transcriptSegmentViewModel: view }] } }
    } })) }
    const parsed = parseTranscriptData(list, '6YnLB0XbTnI')
    expect(parsed).toMatchObject({ hasSegmentList: true, modern: true, continuation: false, videoIdMismatch: false, invalidSegments: 0 })
    expect(parsed.segments).toEqual([
      { start: 0, duration: 0, text: views[0].simpleText },
      { start: 4168, duration: 0, text: views[1].simpleText }
    ])
    // Even a blank cue must belong to the requested video.
    list.contents[2].macroMarkersPanelItemViewModel.onTap.innertubeCommand.watchEndpoint.videoId = 'NYFGCESmikA'
    expect(parseTranscriptData(list, '6YnLB0XbTnI').videoIdMismatch).toBe(true)
  })
  it('skips empty modern cues but retains non-speech captions', () => {
    const views = [
      { timestamp: '0:00', simpleText: '' },
      { timestamp: '0:01', attributedText: { content: ' \n ' }, textUtf16Length: 0 },
      { timestamp: '0:02', simpleText: '[Music]' },
      { timestamp: '0:03', attributedText: { content: '[Applause]' } }
    ]
    const parsed = parseTranscriptData({ targetId: 'PAmodern_transcript_view', contents: views.map(view => ({ transcriptSegmentViewModel: view })) })
    expect(parsed.invalidSegments).toBe(0)
    expect(parsed.segments.map(s => s.text)).toEqual(['[Music]', '[Applause]'])
  })
  it.each([
    { timestamp: '1:75:37' },
    { simpleText: '' },
    { timestamp: '0:00', simpleText: 42 },
    { timestamp: '0:00', attributedText: {} },
    { timestamp: '0:00', textUtf16Length: 20 },
    { timestamp: '0:00', simpleText: '', textUtf16Length: 20 }
  ])('still rejects malformed modern cues: %j', view => {
    const parsed = parseTranscriptData({ targetId: 'PAmodern_transcript_view', contents: [{ transcriptSegmentViewModel: view }] })
    expect(parsed).toMatchObject({ invalidSegments: 1, segments: [] })
  })
})
describe('native message framing', () => {
  it('transfers a large Unicode analysis without exceeding Chromium message limits', () => {
    const event = { id: 'large', type: 'result' as const, result: { answer: '中文😀'.repeat(300000), sources: [1] } }
    const reader = new VideoEventReader('large')
    const results = videoPackets(event).map(packet => {
      expect(encodeNative(packet).length).toBeLessThan(1000004)
      return reader.read(packet)
    }).filter(Boolean)
    expect(results).toEqual([event])
  })
  it('rejects missing or reordered transfer pieces', () => {
    const packets = videoPackets({ id: 'large', type: 'result', result: { answer: 'x'.repeat(300000), sources: [] } })
    expect(() => new VideoEventReader('large').read(packets[1])).toThrow(/Invalid/)
  })
  it('handles UTF-8 byte lengths, fragmented headers and multiple frames', () => {
    const data = Buffer.concat([encodeNative({ text: '中文' }), encodeNative({ action: 'ping' })])
    const decoder = new NativeDecoder(); const messages: unknown[] = []
    for (let i = 0; i < data.length; i++) messages.push(...decoder.feed(data.subarray(i, i + 1)))
    expect(messages).toEqual([{ text: '中文' }, { action: 'ping' }])
  })
  it('refuses an excessive claimed length before buffering a payload', () => {
    const data = Buffer.alloc(4); data.writeUInt32LE(0xffffffff)
    expect(() => new NativeDecoder().feed(data)).toThrow()
  })
})

it('bounds long model-field batches without dropping any fields', () => {
  const fields = Array.from({ length: 400 }, (_, i) => `${i}: ${'中文'.repeat(2500)}`)
  const groups = batchJsonValues(fields)
  expect(groups.flat()).toEqual(fields)
  expect(groups.every(g => JSON.stringify(g).length <= 28000)).toBe(true)
})
