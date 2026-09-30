/**
 * A passage must come back whole.
 *
 * The bug this guards: "keep each section to one or two sentences" lived in the rules
 * shared by every prompt, so a selection of several paragraphs was translated as far
 * as its opening and the rest was dropped without a word. The model was obeying. The
 * code prompt had already had to write its own rules to escape the same sentence,
 * which is the tell that it binds whatever it is attached to.
 */
import { describe, it, expect } from 'vitest'
import { SectionParser, systemPrompt, userPrompt } from '../src/core/explain.js'
import { keepShape, normalize } from '../src/main/capture.js'

const THREE_PARAGRAPHS = [
  'The committee met for three hours without reaching a decision.',
  '',
  'Supporters argued that delay would cost the city its federal match.',
  '',
  'Opponents countered that the plan had never been costed properly.'
].join('\n')

describe('the prompt for a passage', () => {
  it('does not cap the answer at one or two sentences', () => {
    expect(systemPrompt('passage')).not.toMatch(/one or two sentences/)
  })

  it('still caps a word lookup, where brevity is right', () => {
    expect(systemPrompt('word')).toMatch(/one or two sentences/)
  })

  it('asks for the whole selection, paragraph for paragraph', () => {
    const prompt = systemPrompt('passage')
    expect(prompt).toMatch(/WHOLE selection/)
    // Whitespace-tolerant: the prompt is hard-wrapped, and rewrapping it is not a bug.
    expect(prompt).toMatch(/same\s+number\s+of\s+paragraphs/)
    // The two sections a reader actually reads have to say it themselves: a model
    // that skims the preamble still sees it at the section it is writing.
    expect(prompt).toMatch(/## ZH\n[^#]*every paragraph/)
    expect(prompt).toMatch(/## EN\n[^#]*every paragraph/)
  })

  it('leaves the code prompt alone, which already sets its own length', () => {
    expect(systemPrompt('code')).toMatch(/longer answer than a word lookup/)
  })
})

describe('the selection that reaches the model', () => {
  it('keeps every paragraph break, so the model can see the structure it must mirror', () => {
    const raw = keepShape(THREE_PARAGRAPHS)
    const sent = userPrompt({ mode: 'passage', text: normalize(THREE_PARAGRAPHS), raw })

    expect(raw.split(/\n\s*\n/)).toHaveLength(3)
    expect(sent).toContain('Opponents countered that the plan had never been costed properly.')
    expect(sent.split(/\n\s*\n/).length).toBeGreaterThanOrEqual(3)
  })
})

describe('parsing a multi-paragraph answer', () => {
  it('keeps every paragraph of a section, blank lines and all', () => {
    const parser = new SectionParser()
    parser.push('## CODE\nno\n## ZH\n第一段。\n\n第二段。\n\n第三段。\n## EN\nFirst.\n\nSecond.\n\nThird.\n')
    const out = parser.end()

    expect(out.zh).toBe('第一段。\n\n第二段。\n\n第三段。')
    expect(out.en).toBe('First.\n\nSecond.\n\nThird.')
    expect(out.zh?.split(/\n\s*\n/)).toHaveLength(3)
  })

  it('survives chunk boundaries falling inside a blank line', () => {
    const reply = '## ZH\n第一段。\n\n第二段。\n## EN\nFirst.\n\nSecond.\n'
    for (const size of [1, 3, 7, 13]) {
      const parser = new SectionParser()
      for (let i = 0; i < reply.length; i += size) parser.push(reply.slice(i, i + size))
      const out = parser.end()
      expect(out.zh, `chunk size ${size}`).toBe('第一段。\n\n第二段。')
      expect(out.en, `chunk size ${size}`).toBe('First.\n\nSecond.')
    }
  })
})
