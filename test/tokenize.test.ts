import { describe, it, expect } from 'vitest'
import { wordCount } from '../src/core/tokenize.js'

describe('wordCount', () => {
  it('counts contractions and hyphenated words once each', () => {
    // Splitting "he's" into two would push short selections into passage mode.
    expect(wordCount("he's just well-known round here")).toBe(5)
  })

  it('treats typographic apostrophes like straight ones', () => {
    expect(wordCount('don’t')).toBe(1)
  })

  it('ignores punctuation and whitespace', () => {
    expect(wordCount('  Hi, there!  ')).toBe(2)
    expect(wordCount('')).toBe(0)
    expect(wordCount('!!! ... ???')).toBe(0)
  })

  it('counts CJK one character at a time', () => {
    expect(wordCount('你好世界')).toBe(4)
  })

  it('keeps numbers with decimals and separators together', () => {
    expect(wordCount('costs 1,234.56 dollars')).toBe(3)
  })
})
