/**
 * The macOS half of "what sits under this click".
 *
 * Windows reports through a PowerShell script whose output `parsePointRead` parses;
 * macOS walks the Accessibility tree in process and `buildPointRead` assembles the
 * same answer. These check that the second one produces reads the shared rules in
 * core/transcript.ts then recognise — because that is the property that makes the
 * feature behave identically on both platforms, and the only part testable without
 * a screen.
 */
import { describe, it, expect } from 'vitest'
import { buildPointRead, emptyNode, isCaptionNode, isVideoNode, nodeText } from '../src/core/ax.js'
import { transcriptLineAt } from '../src/core/transcript.js'

function node(partial: Partial<ReturnType<typeof emptyNode>>): ReturnType<typeof emptyNode> {
  return { ...emptyNode(), ...partial }
}

describe('recognising elements in the macOS tree', () => {
  it('knows YouTube’s caption window by its DOM id or class', () => {
    expect(isCaptionNode(node({ domId: 'caption-window-1' }))).toBe(true)
    expect(isCaptionNode(node({ domClass: 'caption-window ytp-caption-window-bottom' }))).toBe(true)
    expect(isCaptionNode(node({ domClass: 'ytp-chrome-bottom' }))).toBe(false)
  })

  it('knows a video by its class, its role or the name the page gave it', () => {
    expect(isVideoNode(node({ domClass: 'video-stream html5-main-video' }))).toBe(true)
    expect(isVideoNode(node({ domClass: 'html5-video-player' }))).toBe(true)
    // X names its player rather than classing it, and draws the captions itself.
    expect(isVideoNode(node({ role: 'AXGroup', title: 'Embedded video' }))).toBe(true)
    expect(isVideoNode(node({ role: 'AXGroup', title: 'Related videos' }))).toBe(false)
  })

  it('takes the best name an element has, in the order Chromium fills them', () => {
    expect(nodeText(node({ title: 'aria', description: 'desc', value: 'val' }))).toBe('aria')
    expect(nodeText(node({ description: 'desc', value: 'val' }))).toBe('desc')
    expect(nodeText(node({ value: 'val' }))).toBe('val')
    expect(nodeText(node({}))).toBe('')
  })
})

describe('assembling a point read', () => {
  it('a transcript line is a button named with its spoken time', () => {
    const read = buildPointRead(
      [
        node({ role: 'AXStaticText', value: 'A few years ago, I broke into my own house.' }),
        node({ role: 'AXButton', title: '9 seconds A few years ago, I broke into my own house.' }),
        node({ role: 'AXGroup', domId: 'segments-container' })
      ],
      [],
      null
    )

    expect(read.button).toBe('9 seconds A few years ago, I broke into my own house.')
    expect(transcriptLineAt(read)).toBe('A few years ago, I broke into my own house.')
  })

  it('a caption on the player becomes the caption, wherever in it the click landed', () => {
    const read = buildPointRead(
      [
        node({ role: 'AXGroup', domClass: 'video-stream html5-main-video' }),
        node({ role: 'AXGroup', domClass: 'html5-video-player' })
      ],
      ['so I quickly ran around', 'and tried all the other doors'],
      { x: 0, y: 0, width: 640, height: 360 }
    )

    expect(read.caption).toBe('so I quickly ran around and tried all the other doors')
    expect(transcriptLineAt(read)).toBe('so I quickly ran around and tried all the other doors')
  })

  it('a video with no caption in the tree reports only its rectangle, for the pixels', () => {
    const read = buildPointRead(
      [node({ role: 'AXGroup', title: 'Embedded video' })],
      [],
      { x: 20, y: 300, width: 900, height: 500 }
    )

    // Nothing to explain yet — this is the read that sends the caller to OCR.
    expect(transcriptLineAt(read)).toBeNull()
    expect(read.video).toEqual({ x: 20, y: 300, width: 900, height: 500 })
  })

  it('ordinary page text is not a transcript line', () => {
    const read = buildPointRead(
      [
        node({ role: 'AXStaticText', value: 'Related: How to stay calm when stressed' }),
        node({ role: 'AXGroup', domId: 'related' })
      ],
      [],
      null
    )

    expect(transcriptLineAt(read)).toBeNull()
  })

  it('keeps the chain readable, since a miss is diagnosed from the log', () => {
    const read = buildPointRead(
      [node({ role: 'AXStaticText', value: 'hello', domId: 'x', domClass: 'a b' })],
      [],
      null
    )

    expect(read.chain).toBe("0 AXStaticText id='x' class='a b' name='hello'")
  })
})
