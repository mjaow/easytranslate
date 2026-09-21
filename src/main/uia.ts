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
  captionBand,
  captionBandText,
  parsePointRead,
  transcriptLineAt,
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

/**
 * The caption on a video, read off the pixels.
 *
 * For players that draw captions natively — X does — nothing in the accessibility
 * tree carries the words, so the lower part of the picture is read with OCR instead.
 * Null when nothing legible is there: captions off, or a frame with no line showing.
 */
export async function readCaptionFromVideo(video: {
  x: number
  y: number
  width: number
  height: number
}): Promise<string | null> {
  const result = await readScreenRegion(captionBand(video))
  if (!result.ok) return null
  const caption = captionBandText(result.lines)
  if (!caption || !assessReadability(caption).readable) return null
  return normalize(caption)
}
