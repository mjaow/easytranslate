import { describe, expect, it } from 'vitest'
import { SectionParser, userPrompt } from '../src/core/explain.js'
import { parseNotable } from '../src/core/notable.js'
import {
  lookupPronunciations,
  withDictionaryPronunciations,
  withPronunciationHints
} from '../src/core/pronunciation.js'
import type { ExplainRequest } from '../src/shared/types.js'
import { PRONUNCIATION_USAGE } from '../src/core/pronunciation-usage.js'

describe('bundled American pronunciation dictionary', () => {
  it('gives debit the correct vowel and first-syllable stress, including its plural', () => {
    expect(lookupPronunciations('debit')).toEqual(['/ˈdɛbɪt/'])
    expect(lookupPronunciations('debits')).toEqual(['/ˈdɛbɪts/'])
  })

  it('handles case, selection punctuation, curly apostrophes and hyphens', () => {
    expect(lookupPronunciations(' “DEBIT,” ')).toEqual(lookupPronunciations('debit'))
    expect(lookupPronunciations('don’t')).toEqual(lookupPronunciations("don't"))
    expect(lookupPronunciations('well-known')).not.toEqual([])
  })

  it('does not guess missing words, code, phrases or object properties', () => {
    for (const word of ['qzxnotaword', 'debit card', 'debit()', '__proto__', 'toString', '']) {
      expect(lookupPronunciations(word), word).toEqual([])
    }
  })

  it('attaches usage labels only to pronunciations actually present in the dictionary', () => {
    for (const [word, labels] of Object.entries(PRONUNCIATION_USAGE)) {
      for (const ipa of Object.keys(labels)) expect(lookupPronunciations(word)).toContain(ipa)
    }
  })
})

describe('dictionary pronunciation enrichment', () => {
  const debit: ExplainRequest = { mode: 'word', text: 'debit' }

  it('replaces a cached or freshly generated wrong IPA without altering the explanation', () => {
    const raw = { ipa: '/dɪˈbɪt/', pos: 'noun', zh: '借记', example: 'A debit appeared.' }
    expect(withDictionaryPronunciations(debit, raw)).toEqual({ ...raw, ipa: '/ˈdɛbɪt/' })
    expect(raw.ipa).toBe('/dɪˈbɪt/')
  })

  it('never exposes generated IPA while a response streams', () => {
    const parser = new SectionParser()
    for (const char of '## IPA\n/dɪˈbɪt/\n## POS\nnoun\n') {
      const shown = withDictionaryPronunciations(debit, parser.push(char), false)
      expect(shown.ipa).toBe('/ˈdɛbɪt/')
    }
  })

  it('omits unknown IPA, with the explanation and examples still available', () => {
    const result = withDictionaryPronunciations(
      { mode: 'word', text: 'qzxnotaword' },
      { ipa: '/invented/', zh: '解释', en: 'The explanation still works.' }
    )
    expect(result).toEqual({ zh: '解释', en: 'The explanation still works.' })
  })

  it('shows all read variants when no sentence disambiguates the word', () => {
    const req = withPronunciationHints({ mode: 'word', text: 'read' })
    expect(withDictionaryPronunciations(req, { ipa: '/ˈɹɛd/' }).ipa)
      .toBe('/ˈɹɛd/ or /ˈɹid/')
    expect(withDictionaryPronunciations({ ...req, context: 'read' }, { ipa: '/ˈɹid/' }).ipa)
      .toBe('/ˈɹɛd/ or /ˈɹid/')
  })

  it.each([
    ['I read the book yesterday.', '/ˈɹɛd/'],
    ['I read every day.', '/ˈɹid/']
  ])('accepts only a dictionary candidate selected for: %s', (context, ipa) => {
    const req = withPronunciationHints({ mode: 'word', text: 'read', context })
    expect(userPrompt(req)).toContain(context)
    expect(userPrompt(req)).toContain('past tense or past participle')
    expect(userPrompt(req)).toContain('base form, infinitive, or present tense')
    expect(req.pronunciationHints?.read.map((candidate) => candidate.ipa)).toEqual(['/ˈɹɛd/', '/ˈɹid/'])
    expect(withDictionaryPronunciations(req, { ipa }).ipa).toBe(ipa)
    expect(withDictionaryPronunciations(req, { ipa: '/riˈd/' }).ipa).toBe('/ˈɹɛd/ or /ˈɹid/')
    expect(withDictionaryPronunciations(req, { ipa }, false).ipa).toBe('/ˈɹɛd/ or /ˈɹid/')
  })

  it('cannot treat unsupplied candidates from an old answer as a contextual selection', () => {
    const req: ExplainRequest = { mode: 'word', text: 'read', context: 'I read yesterday.' }
    expect(withDictionaryPronunciations(req, { ipa: '/ˈɹid/' }).ipa).toBe('/ˈɹɛd/ or /ˈɹid/')
  })

  it('replaces passage IPA while preserving the term, Chinese meaning and example', () => {
    const req = withPronunciationHints({ mode: 'passage', text: 'I read about a debit yesterday.' })
    const result = withDictionaryPronunciations(req, {
      notable: [
        'debit · /dɪˈbɪt/ · 借记 · A debit appeared.',
        'read · /ˈɹɛd/ · 阅读 · I read yesterday.',
        'qzxnotaword · /invented/ · 未知词 · An example.'
      ]
    })
    expect(result.notable?.map(parseNotable)).toEqual([
      { term: 'debit', ipa: '/ˈdɛbɪt/', gloss: '借记', example: 'A debit appeared.' },
      { term: 'read', ipa: '/ˈɹɛd/', gloss: '阅读', example: 'I read yesterday.' },
      { term: 'qzxnotaword', ipa: undefined, gloss: '未知词', example: 'An example.' }
    ])
    expect(withDictionaryPronunciations(req, result)).toEqual(result)
  })

  it('removes model IPA from code responses and does not send dictionary hints for code', () => {
    for (const mode of ['word', 'code'] as const) {
      const req = withPronunciationHints({ mode, text: 'read' })
      const result = withDictionaryPronunciations(req, {
        isCode: true, ipa: '/invented/', notable: ['read · /invented/ · 读取']
      })
      expect(result.ipa).toBeUndefined()
      expect(parseNotable(result.notable![0])?.ipa).toBeUndefined()
    }
    expect(withPronunciationHints({ mode: 'code', text: 'read' }).pronunciationHints).toBeUndefined()
  })

  it('keeps the hint budget bounded and does not add unambiguous passage words', () => {
    const text = 'read live record debit '.repeat(1000)
    const hints = withPronunciationHints({ mode: 'passage', text }).pronunciationHints!
    expect(Object.keys(hints)).toEqual(['read', 'live', 'record'])
    expect(Object.keys(hints).length).toBeLessThanOrEqual(40)
    expect(hints.read.map((candidate) => candidate.ipa)).toEqual(lookupPronunciations('read'))
  })
})
