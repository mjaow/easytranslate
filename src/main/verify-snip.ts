/**
 * Self-test for the screen snip: `npm run verify:snip`.
 *
 * Puts a window of known text on screen at a known position, snips exactly that
 * region, and checks the text comes back. It exercises the real `readScreenRegion`,
 * so a broken PowerShell script or a missing OCR language pack fails here rather
 * than silently returning nothing in normal use.
 *
 * Unlike the capture self-test this does not need focus — only visibility — so it
 * runs unattended.
 *
 * Loaded dynamically from a CLI flag, so none of it ships in the normal startup path.
 */
import { app, BrowserWindow, screen } from 'electron'
import { readScreenRegion } from './ocr.js'
import { pickRegion, cancelPick, openOverlayCount, isPicking } from './overlay.js'


const SENTENCE = 'The president calls for federal involvement as opposition grows.'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let passed = 0
let failed = 0

function check(ok: boolean, label: string, detail = ''): void {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

/** Shared words, ignoring case and punctuation — OCR is allowed small slips. */
function overlap(expected: string, actual: string): number {
  const words = (s: string): string[] =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const want = words(expected)
  const got = new Set(words(actual))
  if (want.length === 0) return 0
  return want.filter((w) => got.has(w)).length / want.length
}

export async function runSnipVerification(preloadPath: string): Promise<void> {
  console.log('\nEasyTranslate — screen snip self-test\n')

  if (process.platform !== 'win32') {
    console.log('  Windows only; nothing to check here.\n')
    app.exit(0)
    return
  }

  // Closing the last overlay would otherwise quit the app before the OCR checks
  // run: Electron's default is to exit when no windows remain, and this mode never
  // calls main(), which is where the real app opts out of that.
  app.on('window-all-closed', () => {})

  // --- the picker must stay open until the user acts ------------------------
  //
  // It once cancelled itself instantly on any multi-monitor setup: one overlay is
  // created per display, and the unfocused ones fire blur the moment focus lands
  // elsewhere — which was being treated as "cancel".
  void pickRegion(preloadPath)
  await sleep(1500)

  const openCount = openOverlayCount()
  const displayCount = screen.getAllDisplays().length
  check(
    openCount === displayCount,
    'picker opens one overlay per display and keeps them open',
    `${openCount} open across ${displayCount} display(s)`
  )
  check(isPicking(), 'picker is still waiting for the user')

  cancelPick()
  await sleep(400)
  check(openOverlayCount() === 0, 'cancelling closes every overlay')
  console.log('')

  const display = screen.getPrimaryDisplay()
  const bounds = { x: display.bounds.x + 80, y: display.bounds.y + 80, width: 1000, height: 120 }

  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // Must not take focus, so running this does not disturb whatever is in front.
    focusable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  win.setAlwaysOnTop(true, 'screen-saver')

  // White on near-black at a large size: how subtitles actually look, and the case
  // the OCR engine handles best.
  await win.loadURL(
    'data:text/html,' +
      encodeURIComponent(
        `<body style="margin:0;background:#0f0f0f;display:flex;align-items:center;
             justify-content:center;height:100vh">
           <div style="font:600 30px 'Segoe UI',system-ui;color:#fff">${SENTENCE}</div>
         </body>`
      )
  )
  win.showInactive()

  // Give the compositor time to actually paint before screenshotting it.
  await sleep(900)

  const physical = screen.dipToScreenRect(null, bounds)
  console.log(`  region: ${physical.width}x${physical.height} at ${physical.x},${physical.y}`)
  console.log(`  display scale factor: ${display.scaleFactor}\n`)

  const result = await readScreenRegion(physical)

  check(result.ok, 'OCR returned text', result.ok ? `${result.elapsedMs}ms` : result.reason)

  if (result.ok) {
    const ratio = overlap(SENTENCE, result.text)
    check(ratio >= 0.8, 'text matches what was on screen', `${Math.round(ratio * 100)}% of words`)
    check(result.elapsedMs < 5000, 'completed promptly', `${result.elapsedMs}ms`)
    console.log(`\n  read: "${result.text}"`)
  }

  win.destroy()
  console.log(`\n${failed === 0 ? `All ${passed} snip checks passed.` : `${failed} of ${passed + failed} FAILED.`}\n`)
  app.exit(failed === 0 ? 0 : 1)
}
