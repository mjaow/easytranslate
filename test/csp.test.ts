import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Both windows play synthesized audio as data: URLs. A missing media-src silently
 * breaks playback with Chromium's opaque "no supported source was found" — which
 * looks like a broken API key rather than a policy problem, so it's worth pinning.
 */
describe('renderer CSP', () => {
  for (const page of ['popup', 'settings']) {
    it(`${page} allows data: audio`, () => {
      const html = readFileSync(`src/renderer/${page}/index.html`, 'utf8')
      const csp = /content="([^"]*)"/.exec(html)?.[1] ?? ''
      expect(csp, `${page} has no CSP`).toContain('default-src')
      expect(csp, `${page} cannot play synthesized audio`).toMatch(/media-src[^;]*data:/)
    })
  }
})
