import { describe, it, expect } from 'vitest'
import { parseNotable } from '../src/core/notable.js'

describe('parseNotable', () => {
  it('parses the requested term · /IPA/ · gloss shape', () => {
    expect(parseNotable('refinery · /rɪˈfaɪnəri/ · 炼油厂')).toEqual({
      term: 'refinery',
      ipa: '/rɪˈfaɪnəri/',
      gloss: '炼油厂'
    })
  })

  it('tolerates the em dash models use instead of the middle dot', () => {
    // Worth tolerating: the old prompt asked for dashes, and models drift anyway.
    expect(parseNotable('ablaze — 着火的')).toEqual({
      term: 'ablaze',
      ipa: undefined,
      gloss: '着火的'
    })
  })

  it('keeps a term whose IPA was omitted', () => {
    expect(parseNotable('drone attack · 无人机袭击')).toEqual({
      term: 'drone attack',
      ipa: undefined,
      gloss: '无人机袭击'
    })
  })

  it('keeps a bare term with no gloss at all', () => {
    expect(parseNotable('ablaze')).toEqual({ term: 'ablaze', ipa: undefined, gloss: undefined })
  })

  it('strips list bullets the model may add', () => {
    expect(parseNotable('- ablaze · 着火的')?.term).toBe('ablaze')
    expect(parseNotable('* ablaze · 着火的')?.term).toBe('ablaze')
  })

  it('does not mistake a hyphenated word for a separator', () => {
    // "well-known" must stay one term; only a spaced dash separates fields.
    expect(parseNotable('well-known · 著名的')?.term).toBe('well-known')
  })

  it('returns null for empty input rather than an empty term', () => {
    expect(parseNotable('')).toBeNull()
    expect(parseNotable('   ')).toBeNull()
  })
})
