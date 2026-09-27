import OpenAI from 'openai'
import { describe, expect, it } from 'vitest'
import { describeOpenAiError } from '../src/providers/llm/openai.js'

function transport(code: string): Error {
  return new TypeError('fetch failed', { cause: Object.assign(new Error('sensitive URL and credential'), { code }) })
}

describe('model connection errors', () => {
  it('distinguishes SDK timeouts from connection failures', () => {
    const error = new OpenAI.APIConnectionTimeoutError()
    expect(error).toBeInstanceOf(OpenAI.APIConnectionError)
    expect(describeOpenAiError(error).message).toBe('The model request timed out.')
    expect(describeOpenAiError(error).hint).toContain('No more specific timeout cause')
  })

  it.each([
    ['UND_ERR_CONNECT_TIMEOUT', 'Timed out connecting', 'connection could not be established'],
    ['UND_ERR_HEADERS_TIMEOUT', 'Timed out waiting', 'no HTTP response'],
    ['UND_ERR_BODY_TIMEOUT', 'response stream timed out', 'began responding'],
    ['ETIMEDOUT', 'connection timed out', 'ETIMEDOUT']
  ])('preserves %s when the SDK wraps it as a request timeout', (code, message, hint) => {
    // Matches the SDK's native-fetch error wrapping, including nested causes.
    const error = Object.assign(new OpenAI.APIConnectionTimeoutError(), { cause: transport(code) })
    const detail = describeOpenAiError(error)
    expect(detail.message).toContain(message)
    expect(detail.hint).toContain(hint)
    expect(detail.hint).toContain(code)
    expect(detail.hint).not.toMatch(/sensitive|credential|within the request deadline/)
  })

  it.each([
    ['ENOTFOUND', /resolve/],
    ['EAI_AGAIN', /resolve/],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', /certificate/],
    ['SELF_SIGNED_CERT_IN_CHAIN', /certificate/],
    ['CERT_HAS_EXPIRED', /certificate/],
    ['UND_ERR_CONNECT_TIMEOUT', /Timed out connecting/],
    ['UND_ERR_HEADERS_TIMEOUT', /Timed out waiting/],
    ['UND_ERR_BODY_TIMEOUT', /timed out/],
    ['ECONNRESET', /interrupted/],
    ['UND_ERR_SOCKET', /interrupted/],
    ['ECONNREFUSED', /refused/]
  ])('preserves the safe cause of %s without exposing raw details', (code, message) => {
    const error = new OpenAI.APIConnectionError({ cause: transport(code) })
    const detail = describeOpenAiError(error)
    expect(detail.message).toMatch(message)
    expect(detail.hint).toContain(code)
    expect(detail.hint).not.toMatch(/sensitive|credential/)
  })

  it('recognizes transport errors during streaming without an SDK wrapper', () => {
    expect(describeOpenAiError(transport('UND_ERR_SOCKET')).message).toMatch(/interrupted/)
  })

  it('recognizes aggregate connection failures and safely handles cyclic causes', () => {
    const cycle = new Error('private details') as Error & { cause?: Error }
    cycle.cause = cycle
    const aggregate = new AggregateError([cycle, transport('ECONNREFUSED')])
    expect(describeOpenAiError(new OpenAI.APIConnectionError({ cause: aggregate })).hint).toContain('ECONNREFUSED')
    const unknown = describeOpenAiError(new OpenAI.APIConnectionError({ cause: cycle }))
    expect(unknown.message).toMatch(/connection.*failed/)
    expect(unknown.hint).not.toContain('private details')
  })

  it('does not mistake HTTP rejections for network failures', () => {
    const error = new OpenAI.AuthenticationError(401, { message: 'Invalid key' }, 'Invalid key', new Headers())
    expect(describeOpenAiError(error).message).toMatch(/rejected the API key/)
  })
})
