/**
 * Self-test for reading text under the pointer: `npm run verify:uia`.
 *
 * Puts known text on screen, points at it, and checks the exact line comes back.
 * This is the path that should handle most lookups, so it is worth proving it reads
 * the right line rather than merely returning something.
 */
import { app, BrowserWindow, screen } from 'electron'
import koffi from 'koffi'
import { readTextAtPoint } from './uia.js'

const LINES = [
  'The president calls for federal involvement.',
  'You have got whistleblowers saying that.',
  'It does not have to inherently be a bad thing.'
]

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let passed = 0
let failed = 0

function check(ok: boolean, label: string, detail = ''): void {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

/** Move the pointer, remembering where it was so the desktop is left as found. */
function makeCursor(): { set: (x: number, y: number) => void; restore: () => void } {
  const user32 = koffi.load('user32.dll')
  // The struct has to exist before a prototype can name it.
  koffi.struct('POINT', { x: 'long', y: 'long' })
  const SetCursorPos = user32.func('int __stdcall SetCursorPos(int X, int Y)')
  const GetCursorPos = user32.func('int __stdcall GetCursorPos(_Out_ POINT *p)')

  const out: { x: number; y: number }[] = [{ x: 0, y: 0 }]
  GetCursorPos(out)
  const original = { ...out[0] }

  return {
    set: (x, y) => SetCursorPos(x, y),
    restore: () => SetCursorPos(original.x, original.y)
  }
}

export async function runUiaVerification(): Promise<void> {
  console.log('\nEasyTranslate — read-under-pointer self-test\n')

  if (process.platform !== 'win32') {
    console.log('  Windows only; nothing to check here.\n')
    app.exit(0)
    return
  }
  app.on('window-all-closed', () => {})

  const display = screen.getPrimaryDisplay()
  const bounds = { x: display.bounds.x + 100, y: display.bounds.y + 100, width: 900, height: 260 }

  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  win.setAlwaysOnTop(true, 'screen-saver')

  // Generously spaced lines, so pointing at one cannot accidentally hit another.
  await win.loadURL(
    'data:text/html,' +
      encodeURIComponent(
        `<body style="margin:0;background:#fff;font:20px 'Segoe UI'">
           ${LINES.map((l) => `<p style="margin:26px 20px">${l}</p>`).join('')}
         </body>`
      )
  )
  win.showInactive()
  await sleep(1200)

  const cursor = makeCursor()

  // Chromium builds its accessibility tree the first time a client asks for it, so
  // the first read of a window can come back empty. Warm it up before measuring.
  const warm = screen.dipToScreenPoint({ x: bounds.x + 200, y: bounds.y + 40 })
  const warmStarted = Date.now()
  cursor.set(warm.x, warm.y)
  await sleep(250)
  await readTextAtPoint(warm.x, warm.y)
  console.log(`  (warm-up read took ${Date.now() - warmStarted}ms)
`)

  try {
    for (let i = 0; i < LINES.length; i++) {
      // Aim at the vertical centre of each paragraph.
      const dip = { x: bounds.x + 200, y: bounds.y + 26 + i * 72 + 14 }
      const point = screen.dipToScreenPoint(dip)
      cursor.set(point.x, point.y)
      await sleep(250)

      const started = Date.now()
      const text = await readTextAtPoint(point.x, point.y)
      const elapsed = Date.now() - started

      const expected = LINES[i]
      const got = (text ?? '').trim()
      check(
        got === expected,
        `line ${i + 1} read exactly`,
        got === expected ? `${elapsed}ms` : `got "${got}"`
      )
    }
  } finally {
    cursor.restore()
    win.destroy()
  }

  console.log(
    `\n${failed === 0 ? `All ${passed} pointer-read checks passed.` : `${failed} of ${passed + failed} FAILED.`}\n`
  )
  app.exit(failed === 0 ? 0 : 1)
}
