import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { clearVideoCache, pruneVideoCache, readVideoCache, writeVideoCache, VIDEO_CACHE_MAX_AGE_MS } from '../src/core/video-cache.js'
import type { VideoAnalysis } from '../src/shared/video.js'

const analysis: VideoAnalysis = { overview: 'Saved summary.', takeaways: [], connections: '', ideas: [], evaluation: [], unanswered: [], model: 'test', sections: 1 }
let directory: string
let now: number
const name = (index: number): string => `${index.toString(16).padStart(64, '0')}.json`
function seed(index: number, ageMs: number): string {
  const file = join(directory, name(index))
  writeFileSync(file, JSON.stringify(analysis))
  const saved = new Date(now - ageMs)
  utimesSync(file, saved, saved)
  return file
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'easytranslate-video-cache-test-'))
  now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now)
})
afterEach(() => {
  vi.restoreAllMocks()
  if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error('Unsafe test cleanup path')
  rmSync(directory, { recursive: true, force: true })
})

describe('video summary retention', () => {
  it('clears saved summaries and translations without touching other files, active writes, directories or links', () => {
    const english = seed(1, 0)
    const chinese = seed(2, 0)
    writeFileSync(chinese, JSON.stringify({ ...analysis, translationModel: 'translator' }))
    const other = join(directory, 'settings.json')
    writeFileSync(other, 'keep')
    const active = join(directory, `${name(3)}.00000000-0000-4000-8000-000000000000.tmp`)
    writeFileSync(active, 'active write')
    const nested = join(directory, name(4))
    mkdirSync(nested); writeFileSync(join(nested, name(5)), 'keep')
    const linked = join(directory, name(6))
    symlinkSync(nested, linked, process.platform === 'win32' ? 'junction' : 'dir')
    expect(clearVideoCache(directory)).toEqual({ cleared: 2, failed: 0 })
    expect(existsSync(english)).toBe(false)
    expect(existsSync(chinese)).toBe(false)
    expect(readFileSync(other, 'utf8')).toBe('keep')
    expect(readFileSync(active, 'utf8')).toBe('active write')
    expect(readFileSync(join(nested, name(5)), 'utf8')).toBe('keep')
    expect(lstatSync(linked).isSymbolicLink()).toBe(true)
    expect(clearVideoCache(directory)).toEqual({ cleared: 0, failed: 0 })
    expect(clearVideoCache(join(directory, 'absent'))).toEqual({ cleared: 0, failed: 0 })
  })

  it('expires at seven days and does not extend expiry when a summary is read', () => {
    const file = seed(1, VIDEO_CACHE_MAX_AGE_MS - 1000)
    const savedTime = lstatSync(file).mtimeMs
    expect(readVideoCache(file)).toEqual(analysis)
    expect(lstatSync(file).mtimeMs).toBe(savedTime)
    vi.mocked(Date.now).mockReturnValue(now + 1000)
    expect(readVideoCache(file)).toBeNull()
    expect(existsSync(file)).toBe(false)
  })

  it('keeps only the newest 30 entries, including translated summaries', () => {
    for (let index = 0; index < 40; index++) seed(index, (index + 1) * 1000)
    const translated = join(directory, name(0))
    writeFileSync(translated, JSON.stringify({ ...analysis, translationModel: 'translator' }))
    pruneVideoCache(directory)
    expect(readdirSync(directory)).toHaveLength(30)
    for (let index = 0; index < 40; index++) expect(existsSync(join(directory, name(index)))).toBe(index < 30)
  })

  it('removes expired entries and abandoned writes without touching unrelated files or directories', () => {
    const expired = seed(1, VIDEO_CACHE_MAX_AGE_MS + 1000)
    const fresh = seed(2, 1000)
    const oldTemp = join(directory, `${name(3)}.00000000-0000-4000-8000-000000000000.tmp`)
    writeFileSync(oldTemp, 'incomplete')
    utimesSync(oldTemp, new Date(now - VIDEO_CACHE_MAX_AGE_MS - 1000), new Date(now - VIDEO_CACHE_MAX_AGE_MS - 1000))
    const activeTemp = join(directory, `${name(4)}.00000000-0000-4000-8000-000000000000.tmp`)
    writeFileSync(activeTemp, 'active')
    const unrelated = join(directory, 'notes.json')
    writeFileSync(unrelated, 'keep')
    const nested = join(directory, name(5))
    mkdirSync(nested)
    writeFileSync(join(nested, 'keep.txt'), 'keep')
    pruneVideoCache(directory)
    expect(existsSync(expired)).toBe(false)
    expect(existsSync(oldTemp)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(activeTemp)).toBe(true)
    expect(readFileSync(unrelated, 'utf8')).toBe('keep')
    expect(readFileSync(join(nested, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('enforces retention on writes and leaves no temporary file behind', () => {
    for (let index = 0; index < 30; index++) seed(index, (index + 1) * 1000)
    const file = join(directory, name(100))
    writeVideoCache(file, analysis)
    expect(readVideoCache(file)).toEqual(analysis)
    expect(existsSync(join(directory, name(29)))).toBe(false)
    expect(readdirSync(directory)).toHaveLength(30)
    expect(readdirSync(directory).some(file => file.endsWith('.tmp'))).toBe(false)
  })

  it('handles an absent cache and invalid saved data as misses', () => {
    const absent = join(directory, 'missing')
    expect(() => pruneVideoCache(absent)).not.toThrow()
    expect(readVideoCache(join(absent, name(1)))).toBeNull()
    const file = seed(1, 1000)
    writeFileSync(file, '{broken')
    expect(readVideoCache(file)).toBeNull()
  })
})
