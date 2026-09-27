/**
 * What reaches the clipboard when text is selected in the popup.
 *
 * Selecting is the copy — the popup never takes focus, so there is no keypress to
 * hang this on — which makes the guards here the only thing standing between a stray
 * drag and someone's clipboard. The gesture itself is covered by driving a real
 * CGEvent drag over the real popup; these are the rules that gesture relies on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ written: [] as string[], fail: false }))

vi.mock('electron', () => ({
  app: { getPath: () => '/unused' },
  BrowserWindow: {},
  screen: {},
  clipboard: {
    writeText: async (text: string) => {
      if (fixture.fail) throw new Error('the clipboard is busy')
      fixture.written.push(text)
    }
  }
}))
vi.mock('../src/main/capture.js', () => ({ captureSelection: vi.fn() }))
vi.mock('../src/main/coords.js', () => ({ dipToScreenRect: vi.fn(), screenToDip: vi.fn() }))
vi.mock('../src/main/a11y.js', () => ({ readTranscriptAtPoint: vi.fn(), readCaptionFromVideo: vi.fn() }))
vi.mock('../src/main/native/index.js', () => ({
  IS_MACOS: true,
  copyChordLabel: () => '⌘C',
  foregroundWindowTitle: vi.fn(),
  inputPermission: vi.fn()
}))
vi.mock('../src/main/popup.js', () => ({
  showPopup: vi.fn(),
  updatePopup: vi.fn(),
  hidePopup: vi.fn(),
  isPopupVisible: () => false
}))

const { copySelection } = await import('../src/main/session.js')

beforeEach(() => {
  fixture.written = []
  fixture.fail = false
})

describe('copying a selection out of the popup', () => {
  it('writes what was selected', async () => {
    expect(await copySelection('grandstanding')).toEqual({ ok: true })
    expect(fixture.written).toEqual(['grandstanding'])
  })

  it('trims it, since a drag picks up the whitespace around a word', async () => {
    await copySelection('  为自己的基本盘作秀 \n')
    expect(fixture.written).toEqual(['为自己的基本盘作秀'])
  })

  it('leaves the clipboard alone when nothing is selected', async () => {
    // A plain click collapses the selection. That is not a request to copy anything,
    // and replacing the clipboard with an empty string would be a real loss.
    expect(await copySelection('')).toEqual({ ok: false })
    expect(await copySelection('   \n  ')).toEqual({ ok: false })
    expect(fixture.written).toEqual([])
  })

  it('refuses something far larger than any explanation, rather than pasting it', async () => {
    const result = await copySelection('x'.repeat(20_001))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/too much/i)
    expect(fixture.written).toEqual([])
  })

  it('reports a clipboard failure instead of claiming it copied', async () => {
    fixture.fail = true
    const result = await copySelection('grandstanding')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('the clipboard is busy')
  })
})
