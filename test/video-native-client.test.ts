import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoNativeClient } from '../extension/native-client.js'
import { videoPackets } from '../src/shared/video-wire.js'
import type { VideoEvent } from '../src/shared/video.js'

type Packet = Parameters<Parameters<chrome.runtime.Port['onMessage']['addListener']>[0]>[0]
function mockPort() {
  let message: (value: Packet) => void
  let closed: () => void
  const disconnect = vi.fn() // Like Chrome: a local disconnect has no callback.
  const postMessage = vi.fn()
  return {
    port: { disconnect, postMessage,
      onMessage: { addListener: (f: typeof message) => { message = f } },
      onDisconnect: { addListener: (f: typeof closed) => { closed = f } }
    } as unknown as chrome.runtime.Port,
    disconnect, postMessage,
    receive: (value: Packet) => message(value), close: () => closed()
  }
}
const connected: ReturnType<typeof mockPort>[] = []
const connect = vi.fn(() => { const port = mockPort(); connected.push(port); return port.port })
let client: VideoNativeClient
const result = (id: string): VideoEvent => ({ id, type: 'result', result: { model: 'fixture' } })
beforeEach(() => {
  connected.length = 0; connect.mockClear()
  vi.stubGlobal('chrome', { runtime: { connectNative: connect } })
  client = new VideoNativeClient()
})
afterEach(() => { client.disconnect(); vi.unstubAllGlobals() })

describe('video native connection', () => {
  it('warms a single local helper without sending any requests and retains it across idle navigation', async () => {
    client.warmup(); client.warmup(); client.cancelPending()
    expect(connect).toHaveBeenCalledTimes(1)
    expect(connected[0].postMessage).not.toHaveBeenCalled()
    expect(connected[0].disconnect).not.toHaveBeenCalled()
    const pending = client.request({ id: 'check', action: 'ping' }, vi.fn())
    connected[0].receive(result('check')); await pending
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('cancels busy navigation while leaving the next request free to reconnect', async () => {
    const pending = client.request({ id: 'check', action: 'ping' }, vi.fn())
    const cancelled = expect(pending).rejects.toThrow('cancelled')
    client.cancelPending(); await cancelled
    client.warmup()
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('recovers when speculative warmup fails without failing an explicit request', async () => {
    connect.mockImplementationOnce(() => { throw new Error('Helper unavailable') })
    expect(() => client.warmup()).not.toThrow()
    const pending = client.request({ id: 'check', action: 'ping' }, vi.fn())
    connected[0].receive(result('check')); await pending
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('reuses one helper for sequential requests and keeps status scoped to the request', async () => {
    const oldStatus = vi.fn(), currentStatus = vi.fn()
    const first = client.request({ id: 'ping', action: 'ping' }, oldStatus)
    connected[0].receive(result('ping')); await first
    const second = client.request({ id: 'next', action: 'ping' }, currentStatus)
    connected[0].receive({ id: 'ping', type: 'status', message: 'stale' })
    connected[0].receive({ id: 'next', type: 'status', message: 'current' })
    connected[0].receive(result('next'))
    await expect(second).resolves.toEqual(result('next'))
    expect(connect).toHaveBeenCalledTimes(1)
    expect(connected[0].disconnect).not.toHaveBeenCalled()
    expect(oldStatus).not.toHaveBeenCalled()
    expect(currentStatus).toHaveBeenCalledWith('current')
  })

  it('rejects cancellation without waiting for a Chrome disconnect callback and ignores the old port', async () => {
    const first = client.request({ id: 'first', action: 'ping' }, vi.fn())
    const cancelled = expect(first).rejects.toThrow('cancelled')
    client.disconnect(); await cancelled
    expect(connected[0].disconnect).toHaveBeenCalledOnce()
    const second = client.request({ id: 'next', action: 'ping' }, vi.fn())
    connected[0].receive(result('next')); connected[0].close()
    connected[1].receive(result('next'))
    await expect(second).resolves.toEqual(result('next'))
  })

  it('fails an interrupted request without replaying it and reconnects for the next explicit request', async () => {
    const first = client.request({ id: 'first', action: 'ping' }, vi.fn())
    connected[0].close()
    await expect(first).rejects.toThrow('connection closed')
    expect(connect).toHaveBeenCalledTimes(1)
    const retry = client.request({ id: 'retry', action: 'ping' }, vi.fn())
    connected[1].receive(result('retry')); await retry
    expect(connect).toHaveBeenCalledTimes(2)
    expect(connected[1].postMessage).toHaveBeenCalledOnce()
    expect(connected[1].postMessage).toHaveBeenCalledWith({ id: 'retry', action: 'ping' })
  })

  it('reconnects after an idle helper exit', async () => {
    const first = client.request({ id: 'first', action: 'ping' }, vi.fn())
    connected[0].receive(result('first')); await first
    connected[0].close()
    const next = client.request({ id: 'next', action: 'ping' }, vi.fn())
    connected[1].receive(result('next')); await next
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('keeps a healthy connection after a request-level error and prevents overlapping requests', async () => {
    const first = client.request({ id: 'first', action: 'ping' }, vi.fn())
    await expect(client.request({ id: 'overlap', action: 'ping' }, vi.fn())).rejects.toThrow('still running')
    connected[0].receive({ id: 'first', type: 'error', message: 'Provider failure' })
    await expect(first).rejects.toThrow('Provider failure')
    const next = client.request({ id: 'next', action: 'ping' }, vi.fn())
    connected[0].receive(result('next')); await next
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('reassembles large results independently on the reused port', async () => {
    for (const id of ['one', 'two']) {
      const pending = client.request({ id, action: 'ping' }, vi.fn())
      const event: VideoEvent = { id, type: 'result', result: { answer: 'x'.repeat(250000), sources: [1] } }
      for (const packet of videoPackets(event)) connected[0].receive(packet)
      await expect(pending).resolves.toEqual(event)
    }
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('closes a corrupt transfer and permits the next explicit request', async () => {
    const pending = client.request({ id: 'bad', action: 'ping' }, vi.fn())
    connected[0].receive({ id: 'bad', type: 'packet', index: 1, total: 2, data: 'bad' })
    await expect(pending).rejects.toThrow('Invalid analysis transfer')
    expect(connected[0].disconnect).toHaveBeenCalledOnce()
    const next = client.request({ id: 'next', action: 'ping' }, vi.fn())
    connected[1].receive(result('next')); await next
  })

  it('recovers when posting to a disconnected port throws', async () => {
    const first = client.request({ id: 'first', action: 'ping' }, vi.fn())
    connected[0].receive(result('first')); await first
    connected[0].postMessage.mockImplementationOnce(() => { throw new Error('Disconnected port') })
    await expect(client.request({ id: 'failed', action: 'ping' }, vi.fn())).rejects.toThrow('Disconnected port')
    const next = client.request({ id: 'next', action: 'ping' }, vi.fn())
    connected[1].receive(result('next')); await next
    expect(connect).toHaveBeenCalledTimes(2)
  })
})
