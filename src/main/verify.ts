/**
 * Self-test for the capture path: `npm run verify:capture`.
 *
 * Exercises the real `captureSelection()` against a real focused window and asserts
 * the two properties the whole design rests on — that we read the selection, and
 * that the user's clipboard comes back exactly as it was.
 *
 * Loaded dynamically from a CLI flag, so none of this ships in the normal startup path.
 */
import { app, BrowserWindow, clipboard } from 'electron'
import koffi from 'koffi'
import { captureSelection } from './capture.js'
import { isAvailable, getLoadError, foregroundWindow } from './win32.js'

const SELECTION = 'He is just grandstanding for the base.'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function log(pass: boolean, label: string, detail = ''): boolean {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  return pass
}

/**
 * Drag our own window to the foreground.
 *
 * Only the test needs this. Windows refuses SetForegroundWindow from a process that
 * isn't already foreground — and this one is launched from a terminal that is. The
 * standard workaround is to attach our input queue to the current foreground
 * thread's, which makes Windows treat the two as one for focus purposes.
 *
 * The product never does this: in real use the user has already focused the app they
 * are reading, so the foreground window is correct by definition.
 */
function forceForeground(hwnd: bigint): void {
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')

  const GetWindowThreadProcessId = user32.func(
    'uint32 __stdcall GetWindowThreadProcessId(uintptr hWnd, void *lpdwProcessId)'
  )
  const AttachThreadInput = user32.func(
    'int __stdcall AttachThreadInput(uint32 idAttach, uint32 idAttachTo, int fAttach)'
  )
  const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(uintptr hWnd)')
  const BringWindowToTop = user32.func('int __stdcall BringWindowToTop(uintptr hWnd)')
  const ShowWindow = user32.func('int __stdcall ShowWindow(uintptr hWnd, int nCmdShow)')
  const keybd_event = user32.func(
    'void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)'
  )
  const GetCurrentThreadId = kernel32.func('uint32 __stdcall GetCurrentThreadId()')

  // Tapping Alt makes Windows treat this process as having just received user
  // input, which is what grants it the right to set the foreground window.
  keybd_event(0x12, 0, 0, 0)
  keybd_event(0x12, 0, 2, 0)

  const fgThread = GetWindowThreadProcessId(foregroundWindow(), null)
  const ourThread = GetCurrentThreadId()

  AttachThreadInput(ourThread, fgThread, 1)
  ShowWindow(hwnd, 9) // SW_RESTORE
  BringWindowToTop(hwnd)
  SetForegroundWindow(hwnd)
  AttachThreadInput(ourThread, fgThread, 0)
}

/**
 * Whether the focused window belongs to this process.
 *
 * Comparing HWNDs directly does not work: Electron's getNativeWindowHandle() and
 * GetForegroundWindow() report different handles for the same window (Chromium nests
 * its render widget inside the frame). The owning process id is the reliable test,
 * and it is also the property we actually care about.
 */
function foregroundIsOurs(): boolean {
  try {
    const user32 = koffi.load('user32.dll')
    const GetWindowThreadProcessId = user32.func(
      'uint32 __stdcall GetWindowThreadProcessId(uintptr hWnd, _Out_ uint32 *lpdwProcessId)'
    )
    const out: number[] = [0]
    GetWindowThreadProcessId(foregroundWindow(), out)
    return out[0] === process.pid
  } catch {
    return false
  }
}

/** Title of whatever currently holds focus — only used to explain a failed run. */
function foregroundTitle(): string {
  try {
    const user32 = koffi.load('user32.dll')
    const GetWindowTextW = user32.func(
      'int __stdcall GetWindowTextW(uintptr hWnd, _Out_ uint16 *lpString, int nMaxCount)'
    )
    const buf = new Uint16Array(256)
    const n = GetWindowTextW(foregroundWindow(), buf, 256)
    return n > 0 ? Buffer.from(buf.buffer, 0, n * 2).toString('utf16le') : '(untitled)'
  } catch {
    return '(unknown)'
  }
}

/** Poll until our window holds focus, or give up. Returns whether it got there. */
async function waitForForeground(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  let announced = false
  while (Date.now() < deadline) {
    if (foregroundIsOurs()) return true
    if (!announced) {
      console.log('\n  Waiting for focus — click the "EasyTranslate capture test" window.')
      console.log('  (Windows will not let a terminal-launched app focus itself.)\n')
      announced = true
    }
    await sleep(200)
  }
  return false
}

export async function runCaptureVerification(): Promise<void> {
  console.log('\nEasyTranslate — capture self-test\n')

  if (!isAvailable()) {
    console.log(`  FAIL  Win32 bindings unavailable — ${getLoadError() ?? 'unknown'}`)
    app.exit(1)
    return
  }
  console.log('  PASS  Win32 bindings loaded')

  const win = new BrowserWindow({
    width: 520,
    height: 200,
    title: 'EasyTranslate capture test',
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })

  // A textarea is the closest stand-in for "a real app with a real selection".
  await win.loadURL(
    'data:text/html,' +
      encodeURIComponent(
        `<body style="font:14px system-ui;padding:16px">
           <p>Selecting text and capturing it…</p>
           <textarea id="t" style="width:100%;height:60px">${SELECTION}</textarea>
         </body>`
      )
  )

  win.show()
  app.focus({ steal: true })

  const ourHwnd = win.getNativeWindowHandle().readBigUInt64LE(0)
  forceForeground(ourHwnd)

  // Windows refuses to hand foreground to a process launched from a terminal that
  // already holds it, and no amount of SetForegroundWindow gets around that. So we
  // wait: one click on the test window and the run continues automatically.
  const gotForeground = await waitForForeground(20000)

  log(gotForeground, 'test window is foreground', gotForeground ? '' : 'never received focus')
  if (!gotForeground) {
    console.log(`\n  Focus stayed with: ${foregroundTitle()}`)
    console.log('  Without focus this run proves nothing about capture — it is inconclusive,')
    console.log('  not a failure. Run it again and click the test window when it appears.\n')
    win.destroy()
    app.exit(2)
    return
  }

  await win.webContents.executeJavaScript(
    `(() => { const t = document.getElementById('t'); t.focus(); t.select(); return t.value.length })()`
  )
  await sleep(250)

  // A distinctive sentinel proves the restore put back OUR value, not merely
  // something that happens to look plausible.
  const sentinel = `clipboard-sentinel-${Date.now()}`
  await clipboard.writeText(sentinel)
  await sleep(100)

  const result = await captureSelection()
  await sleep(150)
  const after = await clipboard.readText()

  console.log('')
  let ok = true
  ok = log(result.ok, 'capture returned text', result.ok ? `${result.elapsedMs}ms` : result.reason) && ok
  if (result.ok) {
    ok = log(result.text === SELECTION, 'captured text matches', JSON.stringify(result.text)) && ok
    ok =
      log(result.elapsedMs < 600, 'completed within budget', `${result.elapsedMs}ms of 600ms`) && ok
  }
  ok =
    log(after === sentinel, 'clipboard restored exactly', after === sentinel ? '' : JSON.stringify(after)) &&
    ok

  console.log(`\n${ok ? 'All capture checks passed.' : 'Capture checks FAILED.'}\n`)
  win.destroy()
  app.exit(ok ? 0 : 1)
}
