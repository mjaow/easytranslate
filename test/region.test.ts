import { describe, it, expect } from 'vitest'
import {
  rectFromDrag,
  isUsableRegion,
  dipToPhysical,
  clampToDisplay,
  regionIsStillValid
} from '../src/core/region.js'

const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }
// A second monitor to the right, at 150% — the arrangement that breaks naive scaling.
const secondary = {
  id: 2,
  bounds: { x: 1920, y: 0, width: 1280, height: 720 },
  scaleFactor: 1.5
}

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

describe('dipToPhysical', () => {
  it('leaves an unscaled display untouched', () => {
    const r = { x: 100, y: 200, width: 400, height: 60 }
    expect(dipToPhysical(r, primary)).toEqual(r)
  })

  it('scales size and offset within the display', () => {
    const r = { x: 100, y: 200, width: 400, height: 60 }
    expect(dipToPhysical(r, { bounds: primary.bounds, scaleFactor: 2 })).toEqual({
      x: 200,
      y: 400,
      width: 800,
      height: 120
    })
  })

  it('takes the display origin out before scaling', () => {
    // The bug this pins: scaling the absolute x would give 1920+... and land the
    // region far off the right-hand monitor. Only the offset *within* it scales.
    const r = { x: 1920 + 100, y: 50, width: 200, height: 40 }
    expect(dipToPhysical(r, secondary)).toEqual({
      x: 1920 + 150,
      y: 75,
      width: 300,
      height: 60
    })
  })

  it('keeps a region at the display origin at the origin', () => {
    const r = { x: 1920, y: 0, width: 100, height: 100 }
    expect(dipToPhysical(r, secondary).x).toBe(1920)
    expect(dipToPhysical(r, secondary).y).toBe(0)
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

describe('regionIsStillValid', () => {
  const displays = [primary, secondary]

  it('accepts a region whose display is still attached', () => {
    const region = { x: 100, y: 100, width: 400, height: 60, displayId: 1 }
    expect(regionIsStillValid(region, displays)).toBe(true)
  })

  it('rejects a region whose display has been unplugged', () => {
    // Snipping blind would grab whatever now occupies those coordinates.
    const region = { x: 2000, y: 100, width: 400, height: 60, displayId: 2 }
    expect(regionIsStillValid(region, [primary])).toBe(false)
  })

  it('rejects a region left outside its display after a rearrange', () => {
    const shrunk = [{ id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 } }]
    const region = { x: 1000, y: 100, width: 400, height: 60, displayId: 1 }
    expect(regionIsStillValid(region, shrunk)).toBe(false)
  })

  it('rejects nothing remembered yet', () => {
    expect(regionIsStillValid(null, displays)).toBe(false)
  })
})
