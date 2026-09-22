/**
 * Reading the macOS accessibility tree at a screen point.
 *
 * The counterpart of resources/transcript-at-point.ps1, and a good deal less
 * awkward: the Accessibility API is plain C, so the walk happens in process rather
 * than through a PowerShell start-up, and a double-click gets its answer in a few
 * milliseconds instead of a second.
 *
 * What it reports is deliberately identical to the Windows side — a `PointRead` —
 * so src/core/transcript.ts decides what is a transcript line for both platforms
 * from the same rules.
 */
import {
  attributeElement,
  attributeString,
  attributeStringList,
  axAvailable,
  axTrusted,
  elementAtPoint,
  elementRect,
  mapAttributeElements,
  release,
  type Ref
} from './native/ax.js'
import { buildPointRead, isCaptionNode, isVideoNode, nodeText, type AxNode } from '../core/ax.js'
import type { PointRead } from '../core/transcript.js'

/** As deep as the Windows walk goes: far enough to leave a Chromium leaf behind. */
const MAX_ANCESTORS = 12

/**
 * A ceiling on the caption hunt inside a player. YouTube's player subtree is a few
 * hundred elements; anything past this is a page that is not what we think it is,
 * and a double-click must never become a visible pause.
 */
const MAX_PLAYER_NODES = 600
const MAX_PLAYER_DEPTH = 8

function readNode(element: Ref): AxNode {
  return {
    role: attributeString(element, 'AXRole'),
    title: attributeString(element, 'AXTitle'),
    description: attributeString(element, 'AXDescription'),
    value: attributeString(element, 'AXValue'),
    domId: attributeString(element, 'AXDOMIdentifier'),
    domClass: attributeStringList(element, 'AXDOMClassList').join(' '),
    rect: elementRect(element)
  }
}

/**
 * Gather the text of every caption window inside a player.
 *
 * Same shape as the Windows script: find the caption windows, then take whatever
 * text sits under them, because the individual words are separate elements and only
 * the window itself is reliably present in the tree.
 */
function collectCaptions(player: Ref): string[] {
  const found: string[] = []
  let visited = 0

  const textUnder = (element: Ref, depth: number): string[] => {
    if (depth > MAX_PLAYER_DEPTH || visited > MAX_PLAYER_NODES) return []
    const own = nodeText(readNode(element))
    if (own) return [own]
    return mapAttributeElements(element, 'AXChildren', (child) => {
      visited++
      return textUnder(child, depth + 1)
    }).flat()
  }

  const walk = (element: Ref, depth: number): void => {
    if (depth > MAX_PLAYER_DEPTH || visited > MAX_PLAYER_NODES) return
    mapAttributeElements(element, 'AXChildren', (child) => {
      visited++
      if (visited > MAX_PLAYER_NODES) return
      if (isCaptionNode(readNode(child))) {
        const text = textUnder(child, 0).join(' ').trim()
        if (text) found.push(text)
        return
      }
      walk(child, depth + 1)
    })
  }

  walk(player, 0)
  return found
}

/**
 * Everything the accessibility tree reports at a point, or null when it cannot be
 * read at all — off macOS, or before the user has granted Accessibility.
 */
export async function readPointMac(x: number, y: number): Promise<PointRead | null> {
  if (process.platform !== 'darwin' || !axAvailable() || !axTrusted()) return null

  const leaf = elementAtPoint(x, y)
  if (!leaf) return null

  const owned: Ref[] = [leaf]
  try {
    const chain: AxNode[] = []
    let player: Ref = null
    let foundYouTubePlayer = false
    let videoRect: AxNode['rect'] = null

    let current: Ref = leaf
    for (let depth = 0; current && depth < MAX_ANCESTORS; depth++) {
      const node = readNode(current)
      chain.push(node)

      if (isVideoNode(node)) {
        // The innermost video is the picture itself, and its rectangle is what the
        // caller needs when the captions have to be read off the pixels.
        videoRect ??= node.rect
        // The captions are not inside the <video> element — they are siblings of it
        // inside the player container — so the hunt starts from the outermost
        // video-ish ancestor, and stops at YouTube's own player once that is reached.
        if (!foundYouTubePlayer) {
          player = current
          foundYouTubePlayer = /html5-video-player/.test(node.domClass)
        }
      }

      const parent = attributeElement(current, 'AXParent')
      if (!parent) break
      owned.push(parent)
      current = parent
    }

    const captions = player ? collectCaptions(player) : []
    return buildPointRead(chain, captions, videoRect)
  } catch (err) {
    console.error('[a11y] the accessibility read failed:', err)
    return null
  } finally {
    for (const ref of owned) release(ref)
  }
}
