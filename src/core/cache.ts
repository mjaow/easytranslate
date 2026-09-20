/**
 * Caches so a repeat lookup is instant and free.
 *
 * Deliberately no SQLite in v1 — that would mean a native module and an
 * electron-rebuild step for what is, at this size, a map. Everything goes through
 * CacheStore so the vocabulary/history feature can swap in a real database later
 * without touching callers.
 */
import { createHash } from 'node:crypto'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { join } from 'node:path'

export interface CacheStore<T> {
  get(key: string): T | undefined
  set(key: string, value: T): void
}

const SEP = String.fromCharCode(0)

export function cacheKey(...parts: (string | undefined)[]): string {
  return createHash('sha256')
    .update(parts.map((p) => p ?? '').join(SEP))
    .digest('hex')
    .slice(0, 32)
}

/**
 * Bounded LRU persisted as a single JSON file.
 *
 * Writes are debounced: a reading session produces a lookup every few seconds, and
 * rewriting the whole file each time would be wasteful for no benefit.
 */
export class JsonLruCache<T> implements CacheStore<T> {
  private readonly map = new Map<string, T>()
  private dirty = false
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly file: string,
    private readonly maxEntries = 500,
    private readonly flushDelayMs = 2000
  ) {
    this.load()
  }

  get(key: string): T | undefined {
    if (!this.map.has(key)) return undefined
    // Re-insert so the most recently used entry sits at the end.
    const value = this.map.get(key)!
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: string, value: T): void {
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
    this.dirty = true
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.flushDelayMs)
    this.timer.unref?.()
  }

  flush(): void {
    if (!this.dirty) return
    try {
      writeFileSync(this.file, JSON.stringify([...this.map.entries()]), 'utf8')
      this.dirty = false
    } catch (err) {
      console.error('[cache] flush failed:', err)
    }
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const entries = JSON.parse(readFileSync(this.file, 'utf8')) as [string, T][]
      for (const [k, v] of entries) this.map.set(k, v)
    } catch (err) {
      // A corrupt cache is not worth a crash — start empty and overwrite it.
      console.error('[cache] unreadable, starting empty:', err)
    }
  }
}

/**
 * Audio files on disk, keyed by (text, voice, rate).
 *
 * Kept out of the JSON cache because these are hundreds of kilobytes each; a repeat
 * play should be a file read, not a re-synthesis.
 */
export class AudioCache {
  constructor(
    private readonly dir: string,
    private readonly maxBytes = 50 * 1024 * 1024
  ) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  private path(key: string, ext: string): string {
    return join(this.dir, `${key}.${ext}`)
  }

  get(key: string, ext: string): Buffer | undefined {
    const file = this.path(key, ext)
    try {
      return existsSync(file) ? readFileSync(file) : undefined
    } catch {
      return undefined
    }
  }

  set(key: string, ext: string, data: Buffer): void {
    try {
      writeFileSync(this.path(key, ext), data)
      this.evictIfNeeded()
    } catch (err) {
      console.error('[cache] audio write failed:', err)
    }
  }

  /** Drop the least recently modified files once the directory outgrows its budget. */
  private evictIfNeeded(): void {
    try {
      const files = readdirSync(this.dir)
        .map((name) => {
          const full = join(this.dir, name)
          return { full, ...statSync(full) }
        })
        .sort((a, b) => a.mtimeMs - b.mtimeMs)

      let total = files.reduce((sum, f) => sum + f.size, 0)
      for (const f of files) {
        if (total <= this.maxBytes) break
        unlinkSync(f.full)
        total -= f.size
      }
    } catch (err) {
      console.error('[cache] eviction failed:', err)
    }
  }
}
