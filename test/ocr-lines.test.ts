/**
 * Both recognisers report "x y w h<TAB>text" per line, positioned within the region
 * that was read, and `parseOcrLines` turns that into screen coordinates for the
 * caption rules. Windows' script emits pixels directly; the macOS one converts
 * Vision's normalised, bottom-left-origin boxes first, so this is the contract that
 * keeps one parser serving both.
 */
import { describe, it, expect } from 'vitest'
import { parseOcrLines } from '../src/main/ocr.js'

const region = { x: 100, y: 600, width: 800, height: 120 }

describe('parsing recognised lines', () => {
  it('places each line in screen coordinates', () => {
    const lines = parseOcrLines('40 20 300 24\tThe president calls for federal involvement', region)
    expect(lines).toEqual([
      { text: 'The president calls for federal involvement', x: 140, y: 620, width: 300, height: 24 }
    ])
  })

  it('ignores anything that is not a positioned line', () => {
    const lines = parseOcrLines(
      ['', 'no tab here', 'x y w h\tnot numbers', '0 0 10 10\t   ', '5 6 7 8\tkept'].join('\n'),
      region
    )
    expect(lines.map((l) => l.text)).toEqual(['kept'])
  })

  it('reads the same whichever line endings the platform used', () => {
    const windows = parseOcrLines('1 2 3 4\tone\r\n5 6 7 8\ttwo\r\n', region)
    const mac = parseOcrLines('1 2 3 4\tone\n5 6 7 8\ttwo\n', region)
    expect(windows).toEqual(mac)
    expect(mac).toHaveLength(2)
  })
})
