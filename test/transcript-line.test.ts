import { describe, it, expect } from 'vitest'
import { transcriptLineAt, parsePointRead } from '../src/core/transcript.js'

/**
 * A click anywhere on a video page goes through this, so it has to say yes to a
 * transcript line and no to everything else the page is made of.
 */
describe('transcriptLineAt', () => {
  it('recognises a YouTube transcript button by its spoken-time name', () => {
    const read = {
      button: '1 minute, 5 seconds  A few years ago, I broke into my own house.',
      line: null,
      caption: null,
      chain: ''
    }
    expect(transcriptLineAt(read)).toBe('A few years ago, I broke into my own house.')
  })

  it('handles a bare seconds count and hours', () => {
    expect(
      transcriptLineAt({ button: '9 seconds so I quickly ran around', line: null, caption: null, chain: '' })
    ).toBe('so I quickly ran around')
    expect(
      transcriptLineAt({
        button: '1 hour, 2 minutes, 3 seconds the second hour begins',
        line: null,
        caption: null,
        chain: ''
      })
    ).toBe('the second hour begins')
  })

  it('accepts a line that starts with a clock timestamp', () => {
    expect(transcriptLineAt({ button: null, line: '0:15 you are on a campus', caption: null, chain: '' })).toBe(
      'you are on a campus'
    )
  })

  it('accepts plain text when the page calls it a transcript segment', () => {
    const chain = "0 ControlType.Text id='' class='segment-text' name='and tried all the other doors'"
    expect(
      transcriptLineAt({ button: null, line: 'and tried all the other doors', caption: null, chain })
    ).toBe('and tried all the other doors')
  })

  it('says no to the rest of the page', () => {
    expect(transcriptLineAt({ button: 'Play (k)', line: null, caption: null, chain: '' })).toBeNull()
    expect(
      transcriptLineAt({ button: 'Subscribe', line: 'Subscribe', caption: null, chain: '0 ControlType.Button' })
    ).toBeNull()
    expect(transcriptLineAt({ button: null, line: 'How to stay calm', caption: null, chain: '' })).toBeNull()
    expect(transcriptLineAt({ button: null, line: null, caption: null, chain: '' })).toBeNull()
  })

  it('takes the caption drawn on a video when the click is on the player', () => {
    const chain = "0 ControlType.Group id='' class='video-stream html5-main-video' name=''"
    expect(
      transcriptLineAt({ button: null, line: null, caption: 'so I quickly ran around', chain })
    ).toBe('so I quickly ran around')
    expect(transcriptLineAt({ button: null, line: null, caption: '', chain })).toBeNull()
  })

  it('ignores a time that is the whole name', () => {
    expect(transcriptLineAt({ button: '5 seconds', line: null, caption: null, chain: '' })).toBeNull()
  })
})

describe('parsePointRead', () => {
  it('reads the script output line by line', () => {
    const out = [
      "CHAIN:0 ControlType.Text id='' class='' name='hello'",
      "CHAIN:1 ControlType.Button id='segment' class='' name='9 seconds hello'",
      'BUTTON:9 seconds hello',
      'LINE:hello',
      'CAPTION:and now'
    ].join('\r\n')
    const read = parsePointRead(out)
    expect(read.button).toBe('9 seconds hello')
    expect(read.line).toBe('hello')
    expect(read.caption).toBe('and now')
    expect(read.chain.split('\n')).toHaveLength(2)
  })
})
