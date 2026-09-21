/**
 * Deciding whether what sits under a click is a transcript line, and what it says.
 *
 * Pure so it can be tested without a screen. The accessibility read happens in
 * PowerShell (see resources/transcript-at-point.ps1); it reports what it found and
 * this decides whether that is a transcript line worth explaining.
 *
 * YouTube's transcript panel is a list of buttons — one per line — whose accessible
 * name is the spoken time followed by the text: "1 minute, 5 seconds  and so on".
 * The time-and-text button is the signature; nothing else on a page looks like it.
 * A double-click on the video itself, with captions showing, counts too: the caption
 * on screen is the line being spoken. (Confirmed against a live page: the player
 * holds a "caption-window" group whose words are separate text nodes.)
 */

/** What the accessibility read found under the point. */
export interface PointRead {
  /** Accessible name of the nearest button, if the point is on one. */
  button: string | null
  /** The line of text under the point, if the app exposes text there. */
  line: string | null
  /** The caption currently drawn on a video player the point is inside, if any. */
  caption: string | null
  /**
   * The on-screen rectangle of a video the point is inside, in physical pixels.
   * Some players (X, for one) draw captions natively, where no accessibility tree
   * can see them; the rectangle says where to read the pixels instead.
   */
  video: { x: number; y: number; width: number; height: number } | null
  /** Ancestor chain, one element per line, for diagnostics and weaker matching. */
  chain: string
}

/** "1 hour, 2 minutes, 3 seconds " — the spoken-time prefix on a transcript button. */
const SPOKEN_TIME = /^(?:\d+\s+(?:hours?|minutes?|seconds?)[,\s]*)+/i

/** "0:15 " / "1:02:33 " — a clock-style timestamp at the start of a line. */
const CLOCK_TIME = /^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s+/

function stripPrefix(text: string | null, prefix: RegExp): string | null {
  if (!text) return null
  const trimmed = text.trim()
  const match = trimmed.match(prefix)
  if (!match) return null
  const rest = trimmed.slice(match[0].length).trim()
  return rest.length >= 2 ? rest : null
}

/**
 * The transcript line under a click, or null when the click was on something else.
 *
 * Deliberately strict: a click anywhere in a browser goes through this, and a false
 * positive means a popup over something the user merely clicked. Every rule needs a
 * timestamp or a transcript element in the chain, never just "some text".
 */
export function transcriptLineAt(read: PointRead): string | null {
  // The strongest signal: a button named "<spoken time> <text>". Only YouTube's
  // transcript buttons carry that name.
  const spoken = stripPrefix(read.button, SPOKEN_TIME)
  if (spoken) return spoken

  // A click on the video while captions are showing: the caption is the transcript.
  const caption = read.caption?.trim() ?? ''
  if (caption.length >= 2) return caption

  // A line or button that begins with a clock timestamp — other players' transcripts.
  const clocked = stripPrefix(read.line, CLOCK_TIME) ?? stripPrefix(read.button, CLOCK_TIME)
  if (clocked) return clocked

  // Inside something a page itself calls a transcript segment, take the text as is.
  if (/segment|transcript/i.test(read.chain)) {
    const text = (read.line ?? read.button ?? '').trim()
    if (text.length >= 2) return text
  }

  return null
}

/** Parse the PowerShell script's output into a PointRead. */
export function parsePointRead(stdout: string): PointRead {
  const read: PointRead = { button: null, line: null, caption: null, video: null, chain: '' }
  const chain: string[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    if (raw.startsWith('BUTTON:')) read.button = raw.slice(7)
    else if (raw.startsWith('LINE:')) read.line = raw.slice(5)
    else if (raw.startsWith('CAPTION:')) read.caption = raw.slice(8)
    else if (raw.startsWith('VIDEO:')) {
      const [x, y, width, height] = raw.slice(6).trim().split(/\s+/).map(Number)
      if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
        read.video = { x, y, width, height }
      }
    }
    else if (raw.startsWith('CHAIN:')) chain.push(raw.slice(6))
  }
  read.chain = chain.join('\n')
  return read
}

/** Where a caption sits on a video: the lower part of the picture. */
export function captionBand(video: { x: number; y: number; width: number; height: number }): {
  x: number
  y: number
  width: number
  height: number
} {
  const height = Math.max(40, Math.round(video.height * 0.45))
  return { x: video.x, y: video.y + video.height - height, width: video.width, height }
}

/** "0:07 / 1:30", "0:07", "1:29" — the time readout of a player's control strip. */
const TIME_READOUT = /^\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:\/\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*$/

/**
 * The caption in what OCR read off a video's lower part.
 *
 * The control strip shares that area when it is showing, so its time readout and
 * one-word labels are dropped. What remains is joined into one line.
 */
export function captionBandText(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !TIME_READOUT.test(line))
    .filter((line) => (line.match(/[A-Za-z\u4e00-\u9fff]/g) ?? []).length >= 2)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
