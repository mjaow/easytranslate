import { describe, it, expect } from 'vitest'
import { parseNotable } from '../src/core/notable.js'

describe('parseNotable', () => {
  it('parses the full term · /IPA/ · gloss · example shape', () => {
    expect(
      parseNotable(
        'refinery · /rɪˈfaɪnəri/ · 炼油厂 · The refinery processes crude oil.'
      )
    ).toEqual({
      term: 'refinery',
      ipa: '/rɪˈfaɪnəri/',
      gloss: '炼油厂',
      example: 'The refinery processes crude oil.'
    })
  })

  it('tells gloss from example by script, not position', () => {
    // Models reorder these two, but never write the Chinese gloss in English.
    const swapped = parseNotable(
      'ablaze · /əˈbleɪz/ · The barn was ablaze. · 着火的'
    )
    expect(swapped?.gloss).toBe('着火的')
    expect(swapped?.example).toBe('The barn was ablaze.')
  })

  it('tolerates the em dash models use instead of the middle dot', () => {
    // Worth tolerating: the old prompt asked for dashes, and models drift anyway.
    expect(parseNotable('ablaze — 着火的')).toEqual({
      term: 'ablaze',
      ipa: undefined,
      gloss: '着火的',
      example: undefined
    })
  })

  it('keeps a term whose IPA was omitted', () => {
    expect(parseNotable('drone attack · 无人机袭击')).toEqual({
      term: 'drone attack',
      ipa: undefined,
      gloss: '无人机袭击',
      example: undefined
    })
  })

  it('keeps a bare term with no gloss at all', () => {
    expect(parseNotable('ablaze')).toEqual({
      term: 'ablaze',
      ipa: undefined,
      gloss: undefined,
      example: undefined
    })
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
