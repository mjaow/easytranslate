import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { VideoAnalysis, VideoCacheClearResult } from '../shared/video.js'

export const VIDEO_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const VIDEO_CACHE_MAX_ENTRIES = 30
const ENTRY_NAME = /^[a-f0-9]{64}\.json$/
const TEMP_NAME = /^[a-f0-9]{64}\.json\.[a-f0-9-]{36}\.tmp$/

function remove(file: string): void {
  try { unlinkSync(file) } catch { /* A second worker may have evicted it, or the file may be locked. */ }
}

/** Clear saved analyses only. Never traverse directories/links or remove active writes. */
export function clearVideoCache(directory: string): VideoCacheClearResult {
  const result = { cleared: 0, failed: 0 }
  let names: string[]
  try { names = readdirSync(directory) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result
    throw new Error('The video cache could not be opened. Check access to the EasyUnderstand data folder.')
  }
  for (const name of names) {
    if (!ENTRY_NAME.test(name)) continue
    const file = join(directory, name)
    try {
      if (!lstatSync(file).isFile()) continue
      unlinkSync(file)
      result.cleared++
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.failed++
    }
  }
  return result
}

/** Only recognized cache files in this directory are eligible for deletion. */
export function pruneVideoCache(directory: string, now = Date.now()): void {
  let names: string[]
  try { names = readdirSync(directory) } catch { return }
  const fresh: { file: string; mtime: number }[] = []
  for (const name of names) {
    if (!ENTRY_NAME.test(name) && !TEMP_NAME.test(name)) continue
    const file = join(directory, name)
    try {
      const stat = lstatSync(file)
      if (!stat.isFile()) continue // Never traverse a directory or a symbolic link.
      if (now - stat.mtimeMs >= VIDEO_CACHE_MAX_AGE_MS) remove(file)
      else if (ENTRY_NAME.test(name)) fresh.push({ file, mtime: stat.mtimeMs })
    } catch { /* Concurrent workers can remove entries during cleanup. */ }
  }
  fresh.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file))
  for (const entry of fresh.slice(VIDEO_CACHE_MAX_ENTRIES)) remove(entry.file)
}

export function readVideoCache(file: string): VideoAnalysis | null {
  try {
    const stat = lstatSync(file)
    if (!stat.isFile()) return null
    if (Date.now() - stat.mtimeMs >= VIDEO_CACHE_MAX_AGE_MS) { remove(file); return null }
    const value = JSON.parse(readFileSync(file, 'utf8')) as VideoAnalysis
    // Reading never touches the timestamp: expiry is based on the save time.
    return value && typeof value.overview === 'string' && Array.isArray(value.ideas) ? value : null
  } catch { return null }
}

export function writeVideoCache(file: string, value: VideoAnalysis): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
    renameSync(temporary, file)
  } finally { remove(temporary) }
  pruneVideoCache(dirname(file))
}
