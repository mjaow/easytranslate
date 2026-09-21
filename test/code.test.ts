import { describe, it, expect } from 'vitest'
import { SectionParser, systemPrompt, userPrompt } from '../src/core/explain.js'
import { keepShape } from '../src/main/capture.js'
import { parseConcept } from '../src/core/notable.js'

/**
 * Whether a selection is code is the model's call, not a pattern's. What this side
 * has to get right is smaller: the ordinary prompts must ask for the verdict first,
 * the code prompt must ask for the code sections, the snippet must reach the model
 * with its shape intact, and everything must parse.
 */
describe('code in the prompt', () => {
  it('asks for a code verdict first, whichever mode the word count chose', () => {
    for (const mode of ['word', 'passage'] as const) {
      const prompt = systemPrompt(mode)
      expect(prompt.indexOf('## CODE')).toBeGreaterThan(0)
      expect(prompt.indexOf('## CODE')).toBeLessThan(prompt.indexOf('## ZH'))
      expect(prompt).not.toContain('## STEPS')
    }
  })

  it('has a dedicated prompt for the second step', () => {
    const prompt = systemPrompt('code')
    expect(prompt).toContain('## LANG')
    expect(prompt).toContain('## STEPS')
    expect(prompt).toContain('## CONCEPTS')
    expect(prompt).not.toContain('## CODE')
  })

  it('turns the verdict into a boolean', () => {
    const yes = new SectionParser()
    yes.push('## CODE\nyes\n## ZH\nhi\n')
    expect(yes.end().isCode).toBe(true)
    const no = new SectionParser()
    no.push('## CODE\nNo.\n## ZH\nhi\n')
    expect(no.end().isCode).toBe(false)
    const silent = new SectionParser()
    silent.push('## ZH\nhi\n')
    expect(silent.end().isCode).toBeUndefined()
  })

  it('sends the selection fenced, with its line breaks', () => {
    const raw = 'def f():\n    return 1'
    const prompt = userPrompt({ mode: 'code', text: 'def f(): return 1', raw })
    expect(prompt).toContain('```\ndef f():\n    return 1\n```')
  })

  it('still sends a term with its sentence the old way', () => {
    const prompt = userPrompt({ mode: 'word', text: 'ablaze', context: 'The barn was ablaze.' })
    expect(prompt).toBe('Sentence: The barn was ablaze.\n\nExplain this term from it: ablaze')
  })
})

describe('code reply parsing', () => {
  const REPLY = [
    '## LANG',
    'Python',
    '## ZH',
    '把 0 到 9 中的偶数平方后收集成列表。',
    '## EN',
    'Collects the squares of the even numbers from 0 to 9 into a list.',
    '## STEPS',
    '1. `range(10)` → 生成 0 到 9 的整数',
    '2. `if x % 2 == 0` → 只保留偶数',
    '- `x * x` → 求平方',
    '## CONCEPTS',
    'list comprehension · 列表推导式 · 一行内完成筛选和变换',
    '(none)'
  ].join('\n')

  it('parses the review sections and drops an empty issues list', () => {
    const p = new SectionParser()
    p.push(
      [
        '## LANG',
        'Python',
        '## WHY',
        '把求平均封装成函数，',
        '避免重复。',
        '## DESIGN',
        '- `sum(xs) / len(xs)` → 简洁，但遍历两次',
        '## ISSUES',
        '(none)',
        '## CONCEPTS',
        'built-in functions · 内置函数 · 更快更可读'
      ].join('\n')
    )
    const r = p.end()
    expect(r.why).toBe('把求平均封装成函数，\n避免重复。')
    expect(r.design).toEqual(['`sum(xs) / len(xs)` → 简洁，但遍历两次'])
    expect(r.issues).toBeUndefined()
    expect(r.concepts).toHaveLength(1)
  })

  it('yields lang, numbered-free steps and concepts', () => {
    const p = new SectionParser()
    p.push(REPLY)
    const r = p.end()
    expect(r.lang).toBe('Python')
    expect(r.steps).toEqual([
      '`range(10)` → 生成 0 到 9 的整数',
      '`if x % 2 == 0` → 只保留偶数',
      '`x * x` → 求平方'
    ])
    expect(r.concepts).toEqual(['list comprehension · 列表推导式 · 一行内完成筛选和变换'])
    expect(r.en).toContain('even numbers')
  })

  it('is the same at every chunk size', () => {
    const whole = new SectionParser()
    whole.push(REPLY)
    const reference = whole.end()
    for (const size of [1, 3, 7, 32]) {
      const p = new SectionParser()
      for (let i = 0; i < REPLY.length; i += size) p.push(REPLY.slice(i, i + size))
      expect(p.end(), `chunk size ${size}`).toEqual(reference)
    }
  })

  it('splits a concept line into term and detail', () => {
    expect(parseConcept('`async/await` · 异步等待 · 让异步代码写起来像同步')).toEqual({
      term: 'async/await',
      detail: '异步等待，让异步代码写起来像同步'
    })
    expect(parseConcept('')).toBeNull()
  })
})

describe('keepShape', () => {
  it('keeps line breaks and drops the shared indentation', () => {
    const raw = '\r\n        def f():\r\n            return 1\r\n\r\n'
    expect(keepShape(raw)).toBe('def f():\n    return 1')
  })

  it('turns non-breaking spaces back into spaces and trims line ends', () => {
    expect(keepShape('if x:  \n\u00a0\u00a0\u00a0\u00a0y()')).toBe('if x:\n    y()')
  })
})
