import { describe, it, expect } from 'vitest'

/**
 * Mirrors exampleEnglish() in the popup. The model returns an example sentence
 * with its Chinese translation on the next line; handing both to an American
 * English voice produces nonsense, so only the first line is ever spoken.
 */
function exampleEnglish(example: string): string {
  return example.split('\n')[0]?.trim() ?? ''
}

describe('exampleEnglish', () => {
  it('takes only the English line, never the Chinese translation', () => {
    const example = 'Stop grandstanding and answer the question.\n别作秀了，回答问题。'
    const spoken = exampleEnglish(example)
    expect(spoken).toBe('Stop grandstanding and answer the question.')
    expect(spoken).not.toMatch(/[一-鿿]/)
  })

  it('handles an example with no translation line', () => {
    expect(exampleEnglish('Just the sentence.')).toBe('Just the sentence.')
  })

  it('returns empty for empty input rather than throwing', () => {
    expect(exampleEnglish('')).toBe('')
  })
})
