import { describe, expect, it } from 'vitest'
import { parseWatchPlan } from '../src/core/watch-plan.js'
import { DEFAULT_WATCH_PREFERENCES as preferences, nextFocusRange, watchEstimate, watchPreferences, watchRanges } from '../src/shared/watch-plan.js'
import type { VideoTranscript, WatchSection } from '../src/shared/video.js'

const transcript: VideoTranscript = { videoId: 'lecturetest', title: 'Backpropagation', language: 'en', automatic: false,
  duration: 60, complete: true, source: 'caption-track',
  segments: Array.from({ length: 6 }, (_, i) => ({ start: i * 10, duration: 10, text: `Concept ${i + 1}` })) }
const section = (firstCaption: number, lastCaption: number, recommendation: WatchSection['recommendation'] = 'focus', prerequisites: number[] = []): WatchSection => ({
  firstCaption, lastCaption, recommendation, prerequisites, title: `Concept ${firstCaption}`, reason: 'Needed to follow the derivation.',
  learningTarget: 'Explain the chain rule.', skipCondition: recommendation === 'skip' ? 'You can already apply the chain rule.' : ''
})
const parse = (sections: WatchSection[], t = transcript) => parseWatchPlan({ overview: 'Follow the complete derivation.', sections }, t, preferences, 'gpt-6-luna')

describe('watch-plan validation', () => {
  it('preserves a complete prerequisite chain even when the model recommends skipping it', () => {
    const plan = parse([section(1, 2, 'skip'), section(3, 4, 'skim', [1]), section(5, 6, 'focus', [3])])
    expect(plan.sections.map(s => s.recommendation)).toEqual(['focus', 'focus', 'focus'])
    expect(plan.sections[0].skipCondition).toBe('')
    expect(plan.sections[0].reason).toContain('Concept 3')
    expect(plan.preferences).toEqual(preferences)
    expect(plan.model).toBe('gpt-6-luna')
  })

  it.each([
    [section(2, 6)], [section(1, 2), section(4, 6)], [section(1, 3), section(3, 6)],
    [section(1, 5)], [section(1, 7)], [section(1, 0)], [section(1, 2.5)],
    [section(1, 2), section(3, 6, 'focus', [2])], [section(1, 6, 'focus', [1])]
  ].map(sections => ({ sections })))('rejects incomplete/overlapping coverage and invalid dependencies: $sections', ({ sections }) => {
    expect(() => parse(sections)).toThrow(/Invalid watch plan/)
  })

  it('requires a learning target for focus and an explicit condition for skip', () => {
    expect(() => parse([{ ...section(1, 6), learningTarget: '' }])).toThrow(/empty/)
    expect(() => parse([{ ...section(1, 6, 'skip'), skipCondition: '' }])).toThrow(/empty/)
  })

  it.each([0, -1, 1.5, 721, NaN, '30', undefined])('rejects an invalid time budget %s', budgetMinutes => {
    expect(() => watchPreferences({ ...preferences, budgetMinutes })).toThrow(/time budget/)
  })
})

describe('watch-plan timeline', () => {
  it('derives ordered ranges and estimates from caption times, with conditional skips excluded', () => {
    const plan = parse([section(1, 2), section(3, 4, 'skim'), section(5, 6, 'skip')])
    const ranges = watchRanges(plan, transcript)
    expect(ranges.map(r => [r.start, r.end])).toEqual([[0, 20], [20, 40], [40, 60]])
    expect(watchEstimate(ranges).routeSeconds).toBeCloseTo(20 + 20 / 1.5)
    expect(nextFocusRange(ranges, 21)).toBeUndefined()
  })

  it('splits missing caption intervals out of a skipped section, including both ends', () => {
    const sparse = { ...transcript, duration: 200, segments: [
      { start: 30, duration: 10, text: 'Review.' }, { start: 120, duration: 10, text: 'Repeated review.' }
    ] }
    const ranges = watchRanges(parse([section(1, 2, 'skip')], sparse), sparse)
    expect(ranges.map(r => [r.start, r.end, r.recommendation])).toEqual([
      [0, 30, 'check'], [30, 40, 'skip'], [40, 120, 'check'], [120, 130, 'skip'], [130, 200, 'check']
    ])
    expect(watchEstimate(ranges)).toMatchObject({ checkSeconds: 180, routeSeconds: 180 })
  })

  it('bounds overlapping captions, equal timestamps, and overlong final cues to the video', () => {
    const overlapping = { ...transcript, duration: 30, segments: [
      { start: 0, duration: 20, text: 'Definition.' }, { start: 0, duration: 5, text: 'Correction.' },
      { start: 10, duration: 40, text: 'Example.' }
    ] }
    const ranges = watchRanges(parse([section(1, 2), section(3, 3)], overlapping), overlapping)
    expect(ranges.map(r => [r.start, r.end])).toEqual([[0, 10], [10, 30]])
    expect(watchEstimate(ranges).routeSeconds).toBe(30)
    expect(() => parse([section(1, 1), section(2, 3, 'skip')], overlapping)).toThrow(/sharing a timestamp/)
  })

  it('finds the next focus section from actual playback time, without looping to the start', () => {
    const ranges = watchRanges(parse([section(1, 2), section(3, 4, 'skim'), section(5, 6)]), transcript)
    expect(nextFocusRange(ranges, 5)?.start).toBe(40)
    expect(nextFocusRange(ranges, 40)).toBeUndefined()
  })
})
