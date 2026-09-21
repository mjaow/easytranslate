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

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where to read for the caption: a band around the point that was double-clicked,
 * as wide as the video, or as wide as the screen when the video's reported
 * rectangle does not even contain the point — which happens when a player is shown
 * large or full-screen while the tree still describes its inline box.
 */
export function captionBandAround(point: { x: number; y: number }, video: Box | null, screen: Box): Box {
  const inside =
    video !== null &&
    point.x >= video.x &&
    point.x < video.x + video.width &&
    point.y >= video.y &&
    point.y < video.y + video.height
  const frame = inside && video ? video : screen
  const height = Math.max(90, Math.round(frame.height * 0.16))
  const y = Math.max(frame.y, Math.min(point.y - Math.round(height / 2), frame.y + frame.height - height))
  return { x: frame.x, y, width: frame.width, height }
}

/**
 * "0:07 / 1:30", "0:07", "1:29" — the time readout of a player's control strip,
 * allowing for the stray character or two OCR tacks on from the icons beside it.
 */
const TIME_READOUT = /^\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:\/\s*\d{1,2}:\d{2}(?::\d{2})?)?[^A-Za-z]{0,4}$/

/** A logo or watermark: a few capitals, no lowercase — "GPS", "CNN", "FAREED ZAKARIA". */
const LOGO_LIKE = /^[^a-z]*$/

/**
 * The caption among what OCR found.
 *
 * The line under the double-clicked point is the anchor. The caption is that line
 * plus any other within a line-and-a-half of it that is set in the same size and
 * overlaps it horizontally — the second line of a two-line caption, in short.
 * Everything else in the band is dropped: a control strip's time readout, the source
 * label a player prints in its corner in small type, and the logos and watermarks a
 * broadcast paints in its corners.
 */
export function captionLinesNear(
  lines: { text: string; x: number; y: number; width: number; height: number }[],
  point: { x: number; y: number }
): string {
  const usable = lines
    .map((l) => ({ ...l, text: l.text.trim() }))
    .filter((l) => l.text.length > 0 && !TIME_READOUT.test(l.text))
    .filter((l) => (l.text.match(/[A-Za-z一-鿿]/g) ?? []).length >= 2)
  if (usable.length === 0) return ''

  const centre = (l: { y: number; height: number }): number => l.y + l.height / 2
  const spansX = (l: { x: number; width: number }): boolean =>
    point.x >= l.x - 8 && point.x <= l.x + l.width + 8

  // The anchor: the line the point is on. Prefer one that also spans the point
  // horizontally, so a label off to the side never wins over the caption itself.
  const byDistance = [...usable].sort(
    (a, b) => Math.abs(centre(a) - point.y) - Math.abs(centre(b) - point.y)
  )
  const anchor =
    byDistance.find((l) => spansX(l) && Math.abs(centre(l) - point.y) <= l.height) ?? byDistance[0]
  const reach = Math.max(30, anchor.height * 1.6)
  if (Math.abs(centre(anchor) - point.y) > reach) return ''

  const overlapsAnchor = (l: { x: number; width: number }): boolean => {
    const overlap = Math.min(l.x + l.width, anchor.x + anchor.width) - Math.max(l.x, anchor.x)
    return overlap > 0.3 * Math.min(l.width, anchor.width)
  }

  const chosen = usable
    .filter(
      (l) =>
        l === anchor ||
        (Math.abs(centre(l) - point.y) <= reach && l.height >= anchor.height * 0.5 && overlapsAnchor(l))
    )
    .filter((l) => l === anchor || !LOGO_LIKE.test(l.text) || l.text.split(/\s+/).length > 3)
    .sort((a, b) => a.y - b.y || a.x - b.x)

  return chosen
    .map((l) => l.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
