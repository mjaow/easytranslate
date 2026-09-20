import { describe, it, expect } from 'vitest'
import { toAccelerator, formatAccelerator, type KeyChord } from '../src/shared/accelerator.js'

const chord = (p: Partial<KeyChord>): KeyChord => ({
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  code: 'KeyE',
  ...p
})

describe('toAccelerator', () => {
  it('builds a modifier chord', () => {
    const r = toAccelerator(chord({ ctrlKey: true, altKey: true, code: 'KeyE' }))
    expect(r).toEqual({ ok: true, accelerator: 'CommandOrControl+Alt+E' })
  })

  it('maps both Ctrl and Command to CommandOrControl so one config fits both platforms', () => {
    const ctrl = toAccelerator(chord({ ctrlKey: true, code: 'KeyE' }))
    const cmd = toAccelerator(chord({ metaKey: true, code: 'KeyE' }))
    expect(ctrl).toEqual(cmd)
  })

  it('orders modifiers consistently regardless of press order', () => {
    const r = toAccelerator(chord({ shiftKey: true, altKey: true, ctrlKey: true, code: 'KeyQ' }))
    expect(r).toEqual({ ok: true, accelerator: 'CommandOrControl+Alt+Shift+Q' })
  })

  it('uses the physical key, so layout and Shift do not distort it', () => {
    // Shift+1 reports key "!" but code "Digit1"; a French layout reports "A" for KeyQ.
    const r = toAccelerator(chord({ ctrlKey: true, shiftKey: true, code: 'Digit1' }))
    expect(r).toEqual({ ok: true, accelerator: 'CommandOrControl+Shift+1' })
  })

  it('allows a bare function key but not a bare letter', () => {
    expect(toAccelerator(chord({ code: 'F9' }))).toEqual({ ok: true, accelerator: 'F9' })
    expect(toAccelerator(chord({ code: 'KeyE' }))).toEqual({ ok: false, reason: 'needs-modifier' })
  })

  it('rejects a modifier pressed on its own', () => {
    for (const code of ['ControlLeft', 'AltRight', 'ShiftLeft', 'MetaLeft']) {
      expect(toAccelerator(chord({ code })).ok, code).toBe(false)
    }
  })

  it('rejects keys Electron has no name for', () => {
    expect(toAccelerator(chord({ ctrlKey: true, code: 'Lang1' }))).toEqual({
      ok: false,
      reason: 'unsupported-key'
    })
  })

  it('handles named and punctuation keys', () => {
    expect(toAccelerator(chord({ ctrlKey: true, code: 'Space' })))
      .toEqual({ ok: true, accelerator: 'CommandOrControl+Space' })
    expect(toAccelerator(chord({ altKey: true, code: 'ArrowUp' })))
      .toEqual({ ok: true, accelerator: 'Alt+Up' })
    expect(toAccelerator(chord({ ctrlKey: true, code: 'Slash' })))
      .toEqual({ ok: true, accelerator: 'CommandOrControl+/' })
  })
})

describe('formatAccelerator', () => {
  it('labels keys the way each platform does', () => {
    expect(formatAccelerator('CommandOrControl+Alt+E', false)).toBe('Ctrl + Alt + E')
    expect(formatAccelerator('CommandOrControl+Alt+E', true)).toBe('⌘⌥E')
  })

  it('survives an empty value', () => {
    expect(formatAccelerator('', false)).toBe('')
  })
})
