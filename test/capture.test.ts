import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  sequence: 1,
  payload: {} as Record<string, string>,
  copy: (_attempt: number): void => {},
  readErrors: 0,
  formatsFail: false
}))

vi.mock('electron', () => ({
  ClipboardItem: class {
    constructor(readonly payload: Record<string, Blob | string>) {}
  },
  clipboard: {
    // Electron 44 returns one item even when the clipboard has no formats.
    read: vi.fn(async () => {
      if (fixture.formatsFail) throw new Error('Clipboard is busy')
      return [{
        types: Object.keys(fixture.payload),
        getType: async (type: string) => new Blob([fixture.payload[type]])
      }]
    }),
    readText: vi.fn(async () => {
      if (fixture.readErrors-- > 0) throw new Error('Clipboard is busy')
      return fixture.payload['text/plain'] ?? ''
    }),
    write: vi.fn(async (items: { payload: Record<string, Blob | string> }[]) => {
      fixture.payload = {}
      for (const item of items) {
        for (const [type, value] of Object.entries(item.payload)) {
          fixture.payload[type] = typeof value === 'string' ? value : await value.text()
        }
      }
      fixture.sequence++
    }),
    clear: vi.fn(() => { fixture.payload = {}; fixture.sequence++ })
  }
}))
vi.mock('../src/main/native/index.js', () => ({
  isAvailable: () => true,
  clipboardSequence: () => fixture.sequence,
  sendCopy: vi.fn(() => { fixture.copy(sendCopy.mock.calls.length); return 4 })
}))

import { clipboard } from 'electron'
import { sendCopy as nativeSendCopy } from '../src/main/native/index.js'
import { captureSelection } from '../src/main/capture.js'

const sendCopy = vi.mocked(nativeSendCopy)
const original = {
  'text/plain': 'original clipboard',
  'text/html': '<b>original clipboard</b>',
  'electron application/osclipboard;format="Test format"': 'private data'
}

function publish(payload: Record<string, string>): void {
  fixture.payload = payload
  fixture.sequence++
}

async function capture(): Promise<Awaited<ReturnType<typeof captureSelection>>> {
  const pending = captureSelection(100)
  await vi.runAllTimersAsync()
  return pending
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  fixture.sequence = 1
  fixture.payload = { ...original }
  fixture.copy = () => {}
  fixture.readErrors = 0
  fixture.formatsFail = false
})

afterEach(() => { vi.useRealTimers() })

describe('capturing selected text', () => {
  it('waits for text after the clipboard changes, without copying a second time', async () => {
    fixture.copy = () => {
      publish({})
      // Delayed rendering can make text available without another sequence bump.
      setTimeout(() => { fixture.payload = { 'text/plain': '  This sentence\r\n  needs translation.  ' } }, 60)
    }

    const pending = captureSelection(100)
    await vi.advanceTimersByTimeAsync(20)
    expect(clipboard.write).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()

    expect(await pending).toMatchObject({
      ok: true,
      text: 'This sentence needs translation.',
      raw: 'This sentence\nneeds translation.'
    })
    expect(sendCopy).toHaveBeenCalledTimes(1)
    expect(fixture.payload).toEqual(original)
  })

  it('recovers when a copied-text read is temporarily busy', async () => {
    fixture.copy = () => {
      publish({ 'text/plain': 'The deployment is complete.' })
      fixture.readErrors = 2
    }
    expect(await capture()).toMatchObject({ ok: true, text: 'The deployment is complete.' })
    expect(sendCopy).toHaveBeenCalledTimes(1)
    expect(fixture.payload).toEqual(original)
  })

  it('returns promptly when the selected text is ready', async () => {
    fixture.copy = () => publish({ 'text/plain': 'Ready to translate.' })
    const result = await capture()
    expect(result).toMatchObject({ ok: true, text: 'Ready to translate.' })
    expect(result.elapsedMs).toBeLessThan(100)
  })

  it.each<Record<string, string>>([{}, { 'text/plain': ' \r\n\t' }])('reports an empty selection for %j', async payload => {
    fixture.copy = () => publish(payload)
    expect(await capture()).toMatchObject({ ok: false, reason: 'empty' })
    expect(sendCopy).toHaveBeenCalledTimes(1)
    expect(fixture.payload).toEqual(original)
  })

  it('recognizes actual non-text formats', async () => {
    fixture.copy = () => publish({ 'image/png': 'image bytes' })
    expect(await capture()).toMatchObject({ ok: false, reason: 'not-text' })
    expect(fixture.payload).toEqual(original)
  })

  it('reports an unreadable clipboard instead of calling a failed read an image', async () => {
    fixture.copy = () => {
      publish({ 'text/plain': 'Selected sentence' })
      fixture.readErrors = Infinity
    }
    expect(await capture()).toMatchObject({ ok: false, reason: 'unreadable' })
    expect(fixture.payload).toEqual(original)
  })

  it('restores the clipboard when format enumeration also fails', async () => {
    fixture.copy = () => { publish({}); fixture.formatsFail = true }
    expect(await capture()).toMatchObject({ ok: false, reason: 'unreadable' })
    expect(fixture.payload).toEqual(original)
  })

  it('does not translate old clipboard text when the app never copies', async () => {
    expect(await capture()).toMatchObject({ ok: false, reason: 'no-response' })
    expect(sendCopy).toHaveBeenCalledTimes(2)
    expect(clipboard.readText).not.toHaveBeenCalled()
    expect(clipboard.write).not.toHaveBeenCalled()
    expect(clipboard.clear).not.toHaveBeenCalled()
    expect(fixture.payload).toEqual(original)
  })

  it('retries the shortcut only if the first copy never changed the clipboard', async () => {
    fixture.copy = attempt => {
      if (attempt === 2) publish({ 'text/plain': 'The second copy arrived.' })
    }
    expect(await capture()).toMatchObject({ ok: true, text: 'The second copy arrived.' })
    expect(sendCopy).toHaveBeenCalledTimes(2)
    expect(fixture.payload).toEqual(original)
  })
})
