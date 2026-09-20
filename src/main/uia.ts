/**
 * Reading the text under the pointer from the application's own accessibility tree.
 *
 * This is exact where OCR is a guess — the text comes from the app itself, so there
 * is nothing to misread, no region to configure and nothing to go stale. Point at a
 * transcript line, press the key, get that line.
 *
 * It only works where an app exposes its text, which rules out video frames and
 * images. Those are what the screen-reading fallback exists for.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { normalize } from './capture.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Generous enough for a cold accessibility tree — Chromium builds one lazily the
 * first time a client asks — but short enough that falling back still feels prompt.
 */
const TIMEOUT_MS = 6000

function scriptPath(): string {
  for (const candidate of [
    join(here, '../../resources/read-at-point.ps1'),
    join(process.resourcesPath ?? '', 'resources/read-at-point.ps1')
  ]) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return join(here, '../../resources/read-at-point.ps1')
}

/**
 * The line of text at a screen point, or null when there is none.
 *
 * Returning null is an ordinary outcome, not a failure: most of the screen is not
 * readable text.
 */
export async function readTextAtPoint(x: number, y: number): Promise<string | null> {
  if (process.platform !== 'win32') return null

  const script = scriptPath()
  if (!existsSync(script)) return null

  return new Promise<string | null>((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        String(Math.round(x)),
        String(Math.round(y))
      ],
      { timeout: TIMEOUT_MS, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(null)
          return
        }
        const text = normalize(stdout ?? '')
        // A stray character is not a lookup. Anything this short is noise from a
        // control's label rather than something worth explaining.
        resolve(text.length >= 2 ? text : null)
      }
    )
  })
}
