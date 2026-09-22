/**
 * The offline voice speaks at a rate each platform expresses differently: SAPI takes
 * -10..10, `say` takes words per minute. The setting the user moves is a percentage,
 * so these are the two conversions, and both have to stay inside what the engine
 * accepts or the slow button produces silence instead of slow speech.
 */
import { describe, it, expect } from 'vitest'
import { sapiRate, sayRate } from '../src/providers/tts/system.js'

describe('system voice rate', () => {
  it('leaves the default alone', () => {
    expect(sapiRate(0)).toBe(0)
    expect(sayRate(0)).toBe(175)
  })

  it('maps the turtle button to a slower voice on both platforms', () => {
    expect(sapiRate(-40)).toBe(-4)
    expect(sayRate(-40)).toBe(105)
  })

  it('stays inside what each engine accepts, whatever the config says', () => {
    expect(sapiRate(-1000)).toBe(-10)
    expect(sapiRate(1000)).toBe(10)
    expect(sayRate(-1000)).toBe(60)
    expect(sayRate(1000)).toBe(400)
  })
})
