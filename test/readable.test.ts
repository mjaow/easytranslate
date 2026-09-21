import { describe, it, expect } from 'vitest'
import { assessReadability } from '../src/core/readable.js'

describe('assessReadability', () => {
  it('accepts ordinary English', () => {
    expect(
      assessReadability('that could be used for good things or bad things').readable
    ).toBe(true)
  })

  it('accepts subtitles with contractions and punctuation', () => {
    expect(
      assessReadability("It doesn't have to inherently be a bad thing.").readable
    ).toBe(true)
  })

  it('rejects the garbled read that prompted this', () => {
    // Real OCR output that was confidently explained as "event".
    expect(assessReadability('Fæe aEgvnent >').readable).toBe(false)
  })

  it('rejects text littered with mid-word capitals', () => {
    expect(assessReadability('tHe qUick bRown fOx jUmped').readable).toBe(false)
  })

  it('rejects vowel-less gibberish', () => {
    expect(assessReadability('xkcd brtn mnpq zxcvb').readable).toBe(false)
  })

  it('accepts Chinese without applying Latin rules to it', () => {
    expect(assessReadability('他只是在作秀罢了').readable).toBe(true)
  })

  it('passes very short reads through rather than guessing', () => {
    // One or two words carry too little signal; rejecting them would lose real text.
    expect(assessReadability('event').readable).toBe(true)
    expect(assessReadability('Hugging Face').readable).toBe(true)
  })

  it('treats empty input as unreadable', () => {
    expect(assessReadability('   ').readable).toBe(false)
  })

  it('tolerates a single accented word in otherwise clean text', () => {
    // "café" must not condemn the sentence around it.
    expect(assessReadability('we met at the café before the show started').readable).toBe(true)
  })
})
