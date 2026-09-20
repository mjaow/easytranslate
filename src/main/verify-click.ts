/**
 * Self-test for click-to-explain: `npm run verify:click`.
 *
 * Puts a page on screen built the way YouTube builds its transcript panel — a list
 * of buttons named "<spoken time> <text>" — and its player, with a caption window,
 * then sends real mouse clicks through the OS and checks that each line, and only a
 * line, comes back. This exercises the
 * click watcher, the accessibility read and the transcript rules together, so a
 * broken script or a missed click fails here rather than silently in daily use.
 *
 * What it cannot prove is that YouTube's markup is what this page imitates. That
 * check is one click on a real transcript.
 */
import { app, BrowserWindow, screen } from 'electron'
import koffi from 'koffi'
import { startClickWatcher, stopClickWatcher, type Click } from './clicks.js'
import { readTranscriptAtPoint } from './uia.js'
import { cursorPosition } from './win32.js'

const LINES = [
  ['9 seconds', 'A few years ago, I broke into my own house.'],
  ['1 minute, 5 seconds', 'You have got whistleblowers saying that.'],
  ['2 minutes, 40 seconds', 'It does not have to inherently be a bad thing.']
]

const ROW_TOP = 56
const ROW_HEIGHT = 48
/** The video area sits below the rows and the plain paragraph. */
const PLAYER_TOP = ROW_TOP + 3 * ROW_HEIGHT + 60
const PLAYER_HEIGHT = 140
const CAPTION = 'so I quickly ran around and tried all the other doors'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let passed = 0
let failed = 0

function check(ok: boolean, label: string, detail = ''): void {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

/** Real mouse input through the OS, so the watcher sees exactly what a user's click is. */
function makeMouse(): {
  press: (x: number, y: number) => void
  release: (x: number, y: number) => void
  restore: () => void
} {
  const user32 = koffi.load('user32.dll')
  const SetCursorPos = user32.func('int __stdcall SetCursorPos(int X, int Y)')
  const mouse_event = user32.func(
    'void __stdcall mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, uintptr dwExtraInfo)'
  )
  const LEFTDOWN = 0x0002
  const LEFTUP = 0x0004
  const original = cursorPosition()

  return {
    press: (x, y) => {
      SetCursorPos(x, y)
      mouse_event(LEFTDOWN, 0, 0, 0, 0)
    },
    release: (x, y) => {
      SetCursorPos(x, y)
      mouse_event(LEFTUP, 0, 0, 0, 0)
    },
    restore: () => SetCursorPos(original.x, original.y)
  }
}

export async function runClickVerification(): Promise<void> {
  console.log('\nEasyTranslate — click-to-explain self-test\n')

  if (process.platform !== 'win32') {
    console.log('  Windows only; nothing to check here.\n')
    app.exit(0)
    return
  }
  app.on('window-all-closed', () => {})

  const display = screen.getPrimaryDisplay()
  const bounds = { x: display.bounds.x + 100, y: display.bounds.y + 100, width: 900, height: 480 }

  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  win.setAlwaysOnTop(true, 'screen-saver')

  // The shape of YouTube's transcript panel: each line is a role=button whose
  // aria-label is the spoken time and the text, with the visible parts aria-hidden.
  const rows = LINES.map(
    ([time, text], i) => `
      <div role="button" tabindex="0" aria-label="${time} ${text}"
           style="display:flex;gap:16px;margin:0 20px;height:${ROW_HEIGHT}px;align-items:center">
        <div aria-hidden="true" style="color:#065fd4">${i}:0${i}</div>
        <div aria-hidden="true">${text}</div>
      </div>`
  )
  await win.loadURL(
    'data:text/html,' +
      encodeURIComponent(
        `<title>Self-test - YouTube</title>
         <body style="margin:0;background:#fff;font:18px 'Segoe UI'">
           <h2 style="margin:16px 20px;height:24px;font-size:16px">Transcript</h2>
           ${rows.join('')}
           <p style="margin:16px 20px;height:28px">Related: How to stay calm when stressed</p>
           <div id="movie_player" class="html5-video-player ytp-fullscreen" tabindex="-1" aria-label="YouTube Video Player"
                style="position:relative;margin:0 20px;height:${PLAYER_HEIGHT}px;background:#000">
             <video class="video-stream html5-main-video" style="position:absolute;inset:0;width:100%;height:100%"></video>
             <div class="ytp-caption-window-container">
               <div id="caption-window-1" class="caption-window ytp-caption-window-bottom" tabindex="0" draggable="true" lang="en"
                    style="position:absolute;left:0;right:0;bottom:16px;text-align:center">
                 <span class="captions-text"><span class="caption-visual-line">
                   <span class="ytp-caption-segment" style="background:#000;color:#fff;padding:2px 6px">${CAPTION}</span>
                 </span></span>
               </div>
             </div>
           </div>
         </body>`
      )
  )
  win.show()
  win.focus()
  await sleep(1200)

  const mouse = makeMouse()
  const clicks: Click[] = []
  startClickWatcher((c) => clicks.push(c))

  const clickAt = async (point: { x: number; y: number }): Promise<void> => {
    mouse.press(point.x, point.y)
    await sleep(40)
    mouse.release(point.x, point.y)
  }

  // Chromium builds its accessibility tree the first time a client asks, so warm it
  // up before measuring, as the real app's first click on a fresh window would.
  const warm = screen.dipToScreenPoint({ x: bounds.x + 300, y: bounds.y + 80 })
  await readTranscriptAtPoint(warm.x, warm.y)

  const rowCentre = (i: number): { x: number; y: number } =>
    screen.dipToScreenPoint({ x: bounds.x + 300, y: bounds.y + ROW_TOP + i * ROW_HEIGHT + ROW_HEIGHT / 2 })

  try {
    for (let i = 0; i < LINES.length; i++) {
      const point = rowCentre(i)
      const seen = clicks.length
      await clickAt(point)
      await sleep(120)
      check(clicks.length === seen, `a single click on line ${i + 1} is left alone`)

      await sleep(700) // well past the double-click window, so the next pair stands alone
      await clickAt(point)
      await sleep(80)
      await clickAt(point)
      await sleep(120)
      check(clicks.length === seen + 1, `a double-click on line ${i + 1} is reported once`)

      const started = Date.now()
      const { text } = await readTranscriptAtPoint(point.x, point.y)
      const elapsed = Date.now() - started
      const expected = LINES[i][1]
      check(
        text === expected,
        `line ${i + 1} read exactly`,
        text === expected ? `${elapsed}ms` : `got "${text}"`
      )
    }

    // The rest of the page is not a transcript, and must say so.
    const plain = screen.dipToScreenPoint({
      x: bounds.x + 200,
      y: bounds.y + ROW_TOP + LINES.length * ROW_HEIGHT + 30
    })
    const { text: other } = await readTranscriptAtPoint(plain.x, plain.y)
    check(other === null, 'ordinary text on the page is left alone', other ? `got "${other}"` : '')

    // A double-click on the video, while a caption is showing, reads the caption —
    // even though the point is nowhere near the caption's own text. This is the
    // shape of YouTube's real player: a "caption-window" group holding the words as
    // separate text nodes, confirmed against a live page.
    const video = screen.dipToScreenPoint({ x: bounds.x + 200, y: bounds.y + PLAYER_TOP + 30 })
    const { text: caption } = await readTranscriptAtPoint(video.x, video.y)
    check(
      caption === CAPTION,
      'a click on the video reads the caption on screen',
      caption ? `got "${caption}"` : 'got nothing'
    )

    // A drag is a selection, not a click.
    const seen = clicks.length
    const from = rowCentre(0)
    const to = screen.dipToScreenPoint({ x: bounds.x + 500, y: bounds.y + ROW_TOP + ROW_HEIGHT / 2 })
    mouse.press(from.x, from.y)
    await sleep(60)
    mouse.release(to.x, to.y)
    await sleep(120)
    check(clicks.length === seen, 'a drag is not treated as a click')
  } finally {
    stopClickWatcher()
    mouse.restore()
    win.destroy()
  }

  console.log(
    `\n${failed === 0 ? `All ${passed} click checks passed.` : `${failed} of ${passed + failed} FAILED.`}\n`
  )
  app.exit(failed === 0 ? 0 : 1)
}
