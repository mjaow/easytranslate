import { describe, it, expect } from 'vitest'
import { normalize } from '../src/main/capture.js'

/**
 * Selecting from a video transcript panel is the simplest way to explain what was
 * said — it is ordinary selectable text, so it needs no screen reading at all. The
 * only snag is the timestamp on every line.
 */
describe('transcript selections', () => {
  it('drops the timestamp from each line and rejoins the sentence', () => {
    const selection = [
      "0:15 you're on a campus and um we are",
      '0:18 wrestling with what AI is, what it means'
    ].join('\n')

    expect(normalize(selection)).toBe(
      "you're on a campus and um we are wrestling with what AI is, what it means"
    )
  })

  it('handles hour-length timestamps', () => {
    expect(normalize('1:02:33 the second hour begins')).toBe('the second hour begins')
  })

  it('handles fractional timestamps some players emit', () => {
    expect(normalize('12:04.500 a fractional stamp')).toBe('a fractional stamp')
  })

  it('leaves a time mentioned inside a sentence alone', () => {
    // Only a timestamp at the start of a line is noise; one in the prose is content.
    expect(normalize('The meeting is at 9:30 tomorrow.')).toBe('The meeting is at 9:30 tomorrow.')
  })

  it('leaves a line that merely starts with a number alone', () => {
    expect(normalize('42 percent of respondents agreed')).toBe('42 percent of respondents agreed')
  })

  it('does not strip a bare timestamp with nothing after it', () => {
    // Nothing follows, so it is the content rather than a prefix to remove.
    expect(normalize('0:15')).toBe('0:15')
  })
})
