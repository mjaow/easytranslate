/**
 * Reading text off a region of the screen, for captions a player draws into the
 * picture where no accessibility tree can see them.
 *
 * Each platform uses the recogniser it already ships, so nothing is downloaded and
 * no pixels leave the machine:
 *
 *   Windows  one PowerShell call does the grab and `Windows.Media.Ocr` together. It
 *            must be `powershell.exe` (Windows PowerShell 5.1), never `pwsh` 7 —
 *            PowerShell 7 dropped WinRT, so the OCR type does not resolve there.
 *   macOS    `screencapture` writes the region to a file and the Vision framework
 *            reads it, reached through JavaScript for Automation.
 *
 * Both are given the region in screen coordinates and both return lines positioned
 * within it, so everything above this file is the same on either OS.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

/** One recognised line and where it sat on screen, in physical pixels. */
export interface OcrLine {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export type OcrResult =
  | { ok: true; text: string; lines: OcrLine[]; elapsedMs: number }
  | { ok: false; reason: string; elapsedMs: number }

/** "x y w h<TAB>text" per line, positions relative to the captured region. */
export function parseOcrLines(stdout: string, region: ScreenRegion): OcrLine[] {
  const lines: OcrLine[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    const tab = raw.indexOf('\t')
    if (tab < 0) continue
    const [x, y, width, height] = raw.slice(0, tab).trim().split(/\s+/).map(Number)
    const text = raw.slice(tab + 1).trim()
    if (!text || ![x, y, width, height].every(Number.isFinite)) continue
    lines.push({ text, x: region.x + x, y: region.y + y, width, height })
  }
  return lines
}

function scriptPath(name: string): string {
  // Mirrors how the tray icon is located, so dev and packaged builds agree.
  for (const candidate of [
    join(here, `../../resources/${name}`),
    join(process.resourcesPath ?? '', `resources/${name}`)
  ]) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return join(here, `../../resources/${name}`)
}

/** execFile as a promise that reports the child's own stderr, which both scripts use. */
function run(
  command: string,
  argv: string[],
  timeoutMs: number
): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      argv,
      { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || '').replace(/^ERROR:\s*/m, '').trim()
          resolve({ ok: false, reason: detail || 'Could not read the screen.' })
          return
        }
        resolve({ ok: true, stdout: stdout ?? '' })
      }
    )
  })
}

/**
 * Grab the region and recognise it with Windows.Media.Ocr, in one PowerShell call.
 */
async function readOnWindows(region: ScreenRegion, language: string): Promise<string | { reason: string }> {
  const script = scriptPath('snip-ocr.ps1')
  if (!existsSync(script)) return { reason: 'The screen-reading script is missing.' }

  const result = await run(
    'powershell.exe',
    [
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
    ],
    TIMEOUT_MS
  )
  return result.ok ? result.stdout : { reason: result.reason }
}

/**
 * Grab the region with `screencapture`, then recognise it with Vision.
 *
 * Two steps rather than one because they need two different permissions from the
 * user — Screen Recording to take the picture, nothing at all to read it — and a
 * refusal of the first is worth reporting as itself rather than as "no text found".
 * The capture may come back at Retina scale; the recogniser answers in normalised
 * coordinates, so the script scales its answer to the region we asked for and the
 * difference never reaches this file.
 */
async function readOnMac(region: ScreenRegion, language: string): Promise<string | { reason: string }> {
  const script = scriptPath('snip-ocr.js')
  if (!existsSync(script)) return { reason: 'The screen-reading script is missing.' }

  const dir = await mkdtemp(join(tmpdir(), 'easytranslate-ocr-'))
  const shot = join(dir, 'region.png')
  try {
    const rect = [region.x, region.y, region.width, region.height].map(Math.round).join(',')
    const captured = await run('/usr/sbin/screencapture', ['-x', '-R', rect, shot], TIMEOUT_MS)
    if (!captured.ok) {
      return {
        reason:
          'Could not capture the screen. macOS needs Screen Recording permission for this,' +
          ' in System Settings → Privacy & Security.'
      }
    }
    if (!existsSync(shot)) {
      return {
        reason:
          'The screen capture produced nothing. Grant EasyTranslate Screen Recording in' +
          ' System Settings → Privacy & Security, then restart it.'
      }
    }

    const recognised = await run(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', script, shot, String(Math.round(region.width)), String(Math.round(region.height)), language],
      TIMEOUT_MS
    )
    return recognised.ok ? recognised.stdout : { reason: recognised.reason }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * What an empty read most likely means.
 *
 * Usually it is the ordinary case: the frame had no caption on it. On macOS there is
 * a second cause that looks identical from here — without Screen Recording,
 * `screencapture` succeeds and hands back the desktop picture with every window
 * missing, so the recogniser is given a real image with nothing on it. There is no
 * way to tell the two apart after the fact, so both are named.
 */
const NOTHING_FOUND =
  process.platform === 'darwin'
    ? 'No text found in that area. If this never works, macOS may be withholding the' +
      ' screen: System Settings → Privacy & Security → Screen Recording.'
    : 'No text found in that area.'

/**
 * Read the text inside a screen region.
 *
 * @param language BCP-47 tag for the recogniser. Defaults to American English; each
 *                 platform falls back to its own default if that pack is missing.
 */
export async function readScreenRegion(
  region: ScreenRegion,
  language = 'en-US'
): Promise<OcrResult> {
  const started = Date.now()

  const read =
    process.platform === 'win32'
      ? readOnWindows
      : process.platform === 'darwin'
        ? readOnMac
        : null

  if (!read) {
    return {
      ok: false,
      reason: `Screen reading is not available on ${process.platform}.`,
      elapsedMs: 0
    }
  }

  const stdout = await read(region, language)
  const elapsedMs = Date.now() - started
  if (typeof stdout !== 'string') return { ok: false, reason: stdout.reason, elapsedMs }

  // Both recognisers emit one line per recognised line; normalize() rejoins
  // hard-wrapped lines exactly as it does for copied text, so both paths read alike.
  const lines = parseOcrLines(stdout, region)
  const text = normalize(lines.map((l) => l.text).join('\n'))
  if (!text) return { ok: false, reason: NOTHING_FOUND, elapsedMs }
  return { ok: true, text, lines, elapsedMs }
}
