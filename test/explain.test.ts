import { describe, it, expect } from 'vitest'
import { SectionParser, detectMode, userPrompt } from '../src/core/explain.js'

const WORD_REPLY = [
  '## IPA',
  '/ˈɡrænˌstændɪŋ/',
  '## POS',
  'verb',
  '## ZH',
  '作秀；譫egg众取宠',
  '## EN',
  'Acting showily to impress an audience.',
  '## HERE',
  '指政客的言行是演给支持者看的。',
  '## EX',
  'Stop grandstanding and answer the question.',
  '别作秀了，回答问题。'
].join('\n')

/** Feed a string through the parser in fixed-size slices. */
function streamIn(text: string, size: number) {
  const p = new SectionParser()
  for (let i = 0; i < text.length; i += size) p.push(text.slice(i, i + size))
  return p.end()
}

describe('SectionParser', () => {
  it('parses a complete word reply', () => {
    const r = streamIn(WORD_REPLY, WORD_REPLY.length)
    expect(r.pos).toBe('verb')
    expect(r.en).toBe('Acting showily to impress an audience.')
    expect(r.ipa).toContain('ˈɡræn')
    expect(r.example?.split('\n')).toHaveLength(2)
  })

  it('produces identical output at every chunk size', () => {
    // Chunk boundaries land mid-word, mid-header, and between the two "#" of a
    // header — the parser must not care where the network split the stream.
    const reference = streamIn(WORD_REPLY, WORD_REPLY.length)
    for (const size of [1, 2, 3, 5, 7, 13, 64]) {
      expect(streamIn(WORD_REPLY, size), `chunk size ${size}`).toEqual(reference)
    }
  })

  it('exposes the in-flight line so text appears as it streams', () => {
    const p = new SectionParser()
    p.push('## ZH\n作')
    expect(p.push('秀').zh).toBe('作秀')
  })

  it('splits NOTABLE into one entry per line and drops the (none) marker', () => {
    const p = new SectionParser()
    p.push('## ZH\nhi\n## NOTABLE\ngrandstanding — 作秀\nthe base — 基本盘\n')
    expect(p.end().notable).toEqual([
      'grandstanding — 作秀',
      'the base — 基本盘'
    ])

    const empty = new SectionParser()
    empty.push('## NOTABLE\n(none)\n')
    expect(empty.end().notable).toBeUndefined()
  })

  it('ignores an unknown header rather than appending it to the previous section', () => {
    const p = new SectionParser()
    p.push('## ZH\nkept\n## BOGUS\ndropped\n')
    const r = p.end()
    expect(r.zh).toBe('kept')
    expect(Object.values(r)).not.toContain('dropped')
  })

  it('returns an empty result for a stream that never produced a header', () => {
    const p = new SectionParser()
    p.push('I am afraid I cannot help with that.')
    expect(p.end()).toEqual({})
  })

  it('tolerates a truncated stream mid-section', () => {
    const p = new SectionParser()
    p.push('## ZH\n作秀\n## EN\nActing show')
    const r = p.end()
    expect(r.zh).toBe('作秀')
    expect(r.en).toBe('Acting show')
  })
})

describe('detectMode', () => {
  it('treats short selections as a term and longer ones as a passage', () => {
    expect(detectMode('grandstanding')).toBe('word')
    expect(detectMode('the base')).toBe('word')
    expect(detectMode('kick the bucket')).toBe('word')
    expect(detectMode("he's just grandstanding for the base")).toBe('passage')
  })
})

describe('userPrompt', () => {
  it('includes the sentence as context for a word', () => {
    const p = userPrompt({ mode: 'word', text: 'base', context: 'Playing to the base.' })
    expect(p).toContain('Playing to the base.')
    expect(p).toContain('base')
  })

  it('omits the context line when it would just repeat the term', () => {
    const p = userPrompt({ mode: 'word', text: 'base', context: 'base' })
    expect(p).not.toContain('Sentence:')
  })
})
