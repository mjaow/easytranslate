/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Popup } from '../src/renderer/popup/Popup'
import type { ExplainState, PopupPayload } from '../src/shared/types'

const copySelection = vi.fn<(text: string) => Promise<{ ok: boolean; error?: string }>>()
let clipboardText: string
let update: (payload: PopupPayload) => void
const stopListeners = new Set<() => void>()
let container: HTMLDivElement
let root: Root

const state: ExplainState = {
  mode: 'passage', text: 'A source passage', status: 'done',
  explanation: { zh: 'Alpha beta gamma', en: 'Simple English explanation' }
}

function mouse(target: EventTarget, type: string, button = 0): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, button }))
}

function textElement(): HTMLDivElement {
  return [...container.querySelectorAll('div')].find((el) => el.textContent === state.explanation.zh)!
}

function setSelection(): void {
  const range = document.createRange()
  range.setStart(textElement().firstChild!, 0)
  range.setEnd(textElement().firstChild!, 5)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
}

async function select(): Promise<void> {
  await act(async () => {
    mouse(textElement(), 'mousedown')
    setSelection()
    // A drag can finish outside the element where it began.
    mouse(document, 'mouseup')
  })
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  })
  clipboardText = 'original clipboard'
  copySelection.mockReset().mockImplementation(async (text) => {
    clipboardText = text
    return { ok: true }
  })
  stopListeners.clear()
  Object.defineProperty(window, 'easytranslate', {
    configurable: true,
    value: {
      onUpdate: (listener: typeof update) => { update = listener; return () => {} },
      onStopAudio: (listener: () => void) => {
        stopListeners.add(listener)
        return () => stopListeners.delete(listener)
      },
      copySelection,
      resize: vi.fn(),
      speak: vi.fn(async () => ({ error: 'Voice unavailable' }))
    }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(Popup)))
  await act(async () => update({ state }))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.getSelection()?.removeAllRanges()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('copying from the rendered popup', () => {
  it('copies once on release and copies the same words again after an external clipboard change', async () => {
    await act(async () => {
      mouse(textElement(), 'mousedown')
      setSelection()
    })
    expect(copySelection).not.toHaveBeenCalled()
    await act(async () => mouse(document, 'mouseup'))
    expect(clipboardText).toBe('Alpha')
    expect(container.textContent).toContain('Copied “Alpha”')

    // A second release without a new gesture must not copy the retained selection.
    await act(async () => mouse(document, 'mouseup'))
    expect(copySelection).toHaveBeenCalledTimes(1)
    clipboardText = 'copied in another app'
    await select()
    expect(clipboardText).toBe('Alpha')
    expect(copySelection).toHaveBeenCalledTimes(2)
  })

  it('allows the same words to be copied after hiding and opening another lookup', async () => {
    await select()
    await act(async () => stopListeners.forEach((listener) => listener()))
    expect(container.querySelector('[role="status"]')).toBeNull()
    await act(async () => update({ state: { ...state, text: 'Another source passage' } }))
    clipboardText = 'external copy'
    await select()
    expect(clipboardText).toBe('Alpha')
    expect(copySelection).toHaveBeenCalledTimes(2)
  })

  it('leaves the clipboard alone for a collapsed selection, controls, and non-left clicks', async () => {
    await act(async () => {
      mouse(textElement(), 'mousedown')
      window.getSelection()!.removeAllRanges()
      mouse(document, 'mouseup')
      setSelection()
      const speaker = container.querySelector('.et-selectable button')!
      mouse(speaker, 'mousedown')
      mouse(speaker, 'mouseup')
      mouse(textElement(), 'mousedown', 2)
      mouse(textElement(), 'mouseup', 2)
      mouse(container, 'mousedown')
      mouse(container, 'mouseup')
    })
    expect(copySelection).not.toHaveBeenCalled()
    expect(clipboardText).toBe('original clipboard')
  })

  it.each(['The clipboard is busy.', 'That is too much to copy.'])(
    'shows a returned copy failure and lets the same selection retry: %s', async (error) => {
      copySelection.mockResolvedValueOnce({ ok: false, error })
      await select()
      expect(container.textContent).toContain(error)
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(error)
      expect(container.querySelector('[role="status"]')).toBeNull()
      expect(clipboardText).toBe('original clipboard')
      await act(async () => vi.advanceTimersByTime(5000))
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(error)

      await select()
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(clipboardText).toBe('Alpha')
    }
  )

  it('shows rejected IPC calls and gives a fallback when a failure has no message', async () => {
    copySelection.mockRejectedValueOnce(new Error('Copy service unavailable'))
    await select()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Copy service unavailable')
    copySelection.mockResolvedValueOnce({ ok: false })
    await select()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Could not copy the selection.')
  })

  it('keeps read-aloud failures visible alongside copy feedback', async () => {
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="Read aloud"]')!.click())
    expect(container.textContent).toContain('Voice unavailable')
    copySelection.mockResolvedValueOnce({ ok: false, error: 'Clipboard busy' })
    await select()
    expect(container.textContent).toContain('Voice unavailable')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Clipboard busy')
    await select()
    expect(container.textContent).toContain('Voice unavailable')
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Copied “Alpha”')
  })

  it('restarts the confirmation timer when the same text is copied again', async () => {
    await select()
    await act(async () => vi.advanceTimersByTime(1000))
    await select()
    await act(async () => vi.advanceTimersByTime(1000))
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Copied “Alpha”')
    await act(async () => vi.advanceTimersByTime(600))
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it.each(['hide', 'new lookup'])('discards a late copy result after %s', async (action) => {
    let finish!: (result: { ok: boolean; error?: string }) => void
    copySelection.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await select()
    await act(async () => {
      if (action === 'hide') stopListeners.forEach((listener) => listener())
      else update({ state: { ...state, text: 'Another lookup' } })
    })
    await act(async () => finish({ ok: false, error: 'Late failure' }))
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
