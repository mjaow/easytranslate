/**
 * How much room the model is given to answer.
 *
 * The bug this guards: every lookup asked for 1024 output tokens, which is ample for
 * a dictionary entry and not nearly enough for several paragraphs. A passage came
 * back cut off mid-translation, and the popup told the user to choose a model with a
 * larger output limit — when the limit was the app's own.
 */
import { describe, it, expect } from 'vitest'
import { outputBudget } from '../src/core/explain.js'
import type { ExplainRequest } from '../src/shared/types.js'

const req = (partial: Partial<ExplainRequest> & { text: string }): ExplainRequest => ({
  mode: 'passage',
  ...partial
})

/** Roughly the six-paragraph article the budget was measured against. */
const SIX_PARAGRAPHS = 'x'.repeat(1700)

describe('output budget', () => {
  it('gives a word lookup the small budget it needs, and no more', () => {
    // A dictionary entry fits comfortably in the old flat budget; there is no reason
    // to pay for latency this lookup will never use.
    const budget = outputBudget(req({ mode: 'word', text: 'grandstanding' }))
    expect(budget).toBeGreaterThanOrEqual(1024)
    expect(budget).toBeLessThan(1100)
  })

  it('grows with the selection, so a passage is not cut off', () => {
    const short = outputBudget(req({ text: 'One short sentence about a committee.' }))
    const long = outputBudget(req({ text: SIX_PARAGRAPHS }))
    expect(long).toBeGreaterThan(short)
    // The measured need for this size was ~1060 tokens; the budget must clear it
    // with room to spare rather than land on the edge.
    expect(long).toBeGreaterThan(2000)
  })

  it('scales on the raw selection, which is what the model is actually given', () => {
    const text = 'collapsed to one line'
    const raw = 'x'.repeat(2000)
    expect(outputBudget(req({ text, raw }))).toBeGreaterThan(outputBudget(req({ text })))
  })

  it('gives code more room to start with, since it answers in more sections', () => {
    const snippet = 'const x = 1'
    expect(outputBudget(req({ mode: 'code', text: snippet }))).toBeGreaterThan(
      outputBudget(req({ mode: 'passage', text: snippet }))
    )
  })

  it('never asks for more than every supported model accepts', () => {
    // Above this some providers reject the request outright instead of clamping,
    // which is a hard failure — worse than the truncation it would prevent.
    expect(outputBudget(req({ text: 'x'.repeat(500_000) }))).toBe(4096)
  })

  it('never drops below the old flat budget', () => {
    expect(outputBudget(req({ text: '' }))).toBe(1024)
  })
})
