/**
 * Reading text off a region of the screen.
 *
 * Capture and OCR both happen inside one PowerShell call. The region is chosen in
 * screen coordinates and `CopyFromScreen` takes exactly those, so doing it there rather
 * than via Electron's `desktopCapturer` avoids a round trip through Electron's
 * device-independent pixel abstraction and avoids cropping in JS.
 *
 * It must be `powershell.exe` (Windows PowerShell 5.1), never `pwsh` 7 — PowerShell 7
 * dropped WinRT, so the OCR engine type does not resolve there at all.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { normalize } from './capture.js'

const here = dirname(fileURLToPath(import.meta.url))

/** Capture is fast (~150ms); the rest is PowerShell start-up. This is a safety net. */
const TIMEOUT_MS = 20000

export interface ScreenRegion {
  /** Physical screen pixels — already converted from DIP by the caller. */
  x: number
  y: number
  width: number
  height: number
}

export type OcrResult =
  | { ok: true; text: string; lines: string[]; elapsedMs: number }
  | { ok: false; reason: string; elapsedMs: number }

function scriptPath(): string {
  // Mirrors how the tray icon is located, so dev and packaged builds agree.
  for (const candidate of [
    join(here, '../../resources/snip-ocr.ps1'),
    join(process.resourcesPath ?? '', 'resources/snip-ocr.ps1')
  ]) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return join(here, '../../resources/snip-ocr.ps1')
}

/**
 * Read the text inside a screen region.
 *
 * @param language BCP-47 tag for the OCR recognizer. Defaults to American English;
 *                 the script falls back to the user's profile languages if the
 *                 requested pack is not installed.
 */
export async function readScreenRegion(
  region: ScreenRegion,
  language = 'en-US'
): Promise<OcrResult> {
  const started = Date.now()

  if (process.platform !== 'win32') {
    return { ok: false, reason: 'Screen reading is only available on Windows.', elapsedMs: 0 }
  }

  const script = scriptPath()
  if (!existsSync(script)) {
    return { ok: false, reason: 'The screen-reading script is missing.', elapsedMs: 0 }
  }

  const argv = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    String(Math.round(region.x)),
    String(Math.round(region.y)),
    String(Math.round(region.width)),
    String(Math.round(region.height)),
    language
  ]

  return new Promise<OcrResult>((resolve) => {
    execFile(
      'powershell.exe',
      argv,
      { timeout: TIMEOUT_MS, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const elapsedMs = Date.now() - started

        if (err) {
          // The script reports its own failures on stderr prefixed with ERROR:.
          const detail = (stderr || '').replace(/^ERROR:\s*/m, '').trim()
          resolve({
            ok: false,
            reason: detail || 'Could not read the screen.',
            elapsedMs
          })
          return
        }

        // OCR emits one line per recognised line; normalize() rejoins hard-wrapped
        // lines exactly as it does for copied text, so both paths read alike.
        const lines = (stdout ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        const text = normalize(stdout ?? '')
        if (!text) {
          resolve({ ok: false, reason: 'No text found in that area.', elapsedMs })
          return
        }
        resolve({ ok: true, text, lines, elapsedMs })
      }
    )
  })
}
