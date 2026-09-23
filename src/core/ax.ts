/**
 * Turning what the macOS accessibility tree reported at a point into the same
 * `PointRead` the Windows side produces.
 *
 * Pure, so the rules can be tested without a screen — the mirror of what
 * resources/transcript-at-point.ps1 prints and `parsePointRead` parses on Windows.
 * The walk itself is in src/main/native/ax.ts; this only decides what the walk found.
 *
 * The shapes differ between the two trees, and that is the whole reason this file
 * exists. UI Automation gives Chromium's HTML class attribute as the element's class
 * name, so "caption-window" is matched directly. macOS gives no class attribute at
 * all: a Chromium element arrives as a role (AXGroup, AXStaticText, AXButton) with a
 * title, a description and sometimes a DOM id, so a caption has to be recognised by
 * the identifier and the role instead.
 */
import type { PointRead } from './transcript.js'

/** One element of the ancestor chain, as the accessibility walk saw it. */
export interface AxNode {
  /** AXRole, e.g. "AXButton", "AXStaticText", "AXGroup". */
  role: string
  /** AXTitle — for a Chromium element, usually its aria-label. */
  title: string
  /** AXDescription — Chromium's fallback accessible name. */
  description: string
  /** AXValue when it is text, which is where AXStaticText keeps its words. */
  value: string
  /** AXDOMIdentifier: the HTML id, which Chromium does expose on macOS. */
  domId: string
  /** AXDOMClassList joined by spaces, when Chromium reports it. */
  domClass: string
  /** On-screen rectangle in points. */
  rect: { x: number; y: number; width: number; height: number } | null
}

export function emptyNode(): AxNode {
  return { role: '', title: '', description: '', value: '', domId: '', domClass: '', rect: null }
}

/** The best name an element has: aria-label, then its description, then its text. */
export function nodeText(node: AxNode): string {
  return (node.title || node.description || node.value || '').trim()
}

/** Whether an element is one of YouTube's caption windows. */
export function isCaptionNode(node: AxNode): boolean {
  return /caption-window/.test(node.domId) || /caption-window/.test(node.domClass)
}

/** Whether an element is a video player worth reading pixels from. */
export function isVideoNode(node: AxNode): boolean {
  if (/html5-video-player|video-stream/.test(node.domClass)) return true
  if (node.role === 'AXVideo' || node.role === 'AXVideoArea') return true
  const name = `${node.title} ${node.description}`.toLowerCase()
  return name === 'video' || name.includes('embedded video') || name.includes('captions')
}

/**
 * Assemble the read.
 *
 * `chain` runs from the element under the pointer outward to the window;
 * `captionTexts` is whatever was found inside a player's caption windows, and
 * `videoRect` the rectangle of the innermost video the point was inside.
 */
export function buildPointRead(
  chain: AxNode[],
  captionTexts: string[],
  videoRect: AxNode['rect']
): PointRead {
  let button: string | null = null
  let line: string | null = null

  for (const node of chain) {
    const text = nodeText(node)
    if (!button && node.role === 'AXButton' && text) button = text
    // The line under the pointer: macOS has no TextPattern, but Chromium leaves the
    // words in the AXStaticText leaf the pointer is actually over, which is the same
    // unit a line range would have given.
    if (!line && (node.role === 'AXStaticText' || node.role === 'AXTextArea') && text) line = text
  }

  const caption = captionTexts
    .map((t) => t.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    button,
    line,
    caption: caption || null,
    video: videoRect,
    chain: chain
      .map(
        (node, depth) =>
          `${depth} ${node.role} id='${node.domId}' class='${node.domClass}' name='${nodeText(node)}'`
      )
      .join('\n')
  }
}
