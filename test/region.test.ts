import { describe, it, expect } from 'vitest'
import { rectFromDrag, isUsableRegion, clampToDisplay } from '../src/core/region.js'

const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }

describe('rectFromDrag', () => {
  it('normalises a drag made in any direction', () => {
    const downRight = rectFromDrag({ x: 10, y: 20 }, { x: 110, y: 70 })
    const upLeft = rectFromDrag({ x: 110, y: 70 }, { x: 10, y: 20 })
    expect(downRight).toEqual({ x: 10, y: 20, width: 100, height: 50 })
    expect(upLeft).toEqual(downRight)
  })
})

describe('isUsableRegion', () => {
  it('rejects a stray click but accepts a real selection', () => {
    expect(isUsableRegion({ x: 0, y: 0, width: 2, height: 200 })).toBe(false)
    expect(isUsableRegion({ x: 0, y: 0, width: 0, height: 0 })).toBe(false)
    expect(isUsableRegion({ x: 0, y: 0, width: 400, height: 60 })).toBe(true)
  })
})

describe('clampToDisplay', () => {
  it('trims a region that runs past the edge', () => {
    const r = { x: 1800, y: 1000, width: 400, height: 400 }
    expect(clampToDisplay(r, primary.bounds)).toEqual({
      x: 1800,
      y: 1000,
      width: 120,
      height: 80
    })
  })

  it('pulls a region that starts outside back to the edge', () => {
    expect(clampToDisplay({ x: -50, y: -50, width: 100, height: 100 }, primary.bounds)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100
    })
  })

  it('leaves a region fully inside alone', () => {
    const r = { x: 10, y: 10, width: 100, height: 100 }
    expect(clampToDisplay(r, primary.bounds)).toEqual(r)
  })
})
