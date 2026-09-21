/**
 * Reading what sits under a screen point from the application's own accessibility
 * tree, to recognise a click on a transcript line.
 *
 * This is exact where OCR is a guess: the text comes from the app itself, so there is
 * nothing to misread. It only works where an app exposes its text, which rules out
 * video frames and images — that is what reading the screen is for.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { normalize } from './capture.js'
import { readScreenRegion } from './ocr.js'
import { assessReadability } from '../core/readable.js'
import {
  captionBandAround,
  captionLinesNear,
  parsePointRead,
  transcriptLineAt,
  type Box,
  type PointRead
} from '../core/transcript.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Generous enough for a cold accessibility tree — Chromium builds one lazily the
 * first time a client asks — but short enough that a miss still feels prompt.
 */
const TIMEOUT_MS = 6000

function scriptPath(): string {
  for (const candidate of [
    join(here, '../../resources/transcript-at-point.ps1'),
    join(process.resourcesPath ?? '', 'resources/transcript-at-point.ps1')
  ]) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return join(here, '../../resources/transcript-at-point.ps1')
}

/** Everything the accessibility tree reports at a point. Null off Windows. */
export async function readPoint(x: number, y: number): Promise<PointRead | null> {
  if (process.platform !== 'win32') return null

  const script = scriptPath()
  if (!existsSync(script)) return null

  return new Promise<PointRead | null>((resolve) => {
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
      (err, stdout) => resolve(err ? null : parsePointRead(stdout ?? ''))
    )
  })
}

export interface TranscriptRead {
  /** The transcript line, or null when the point is not on one. */
  text: string | null
  /** What the tree reported, so a miss can be understood after the fact. */
  read: PointRead | null
}

/** The transcript line at a screen point, if there is one. */
export async function readTranscriptAtPoint(x: number, y: number): Promise<TranscriptRead> {
  const read = await readPoint(x, y)
  if (!read) return { text: null, read }
  const line = transcriptLineAt(read)
  return { text: line ? normalize(line) : null, read }
}

export interface CaptionRead {
  /** The caption line that was double-clicked, or null when nothing legible was there. */
  text: string | null
  /** What was tried, for the log: the band read and every line OCR found in it. */
  band: Box
  lines: string[]
}

/**
 * The caption on a video, read off the pixels around the double-clicked point.
 *
 * For players that draw captions natively — X does — nothing in the accessibility
 * tree carries the words, so the row of pixels the user pointed at is read with OCR
 * instead. Null text when nothing legible is there: captions off, or a frame with
 * no line showing.
 */
export async function readCaptionFromVideo(
  point: { x: number; y: number },
  video: Box | null,
  screen: Box
): Promise<CaptionRead> {
  const band = captionBandAround(point, video, screen)
  const result = await readScreenRegion(band)
  if (!result.ok) return { text: null, band, lines: [] }
  const lines = result.lines.map((l) => `${l.x},${l.y} ${l.width}x${l.height}  ${l.text}`)
  const caption = captionLinesNear(result.lines, point)
  if (!caption || !assessReadability(caption).readable) return { text: null, band, lines }
  return { text: normalize(caption), band, lines }
}
