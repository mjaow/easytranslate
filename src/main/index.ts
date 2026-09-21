import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { IPC, type AppConfig, type SecretId } from '../shared/types.js'
import { createPopupWindow, hidePopup, resizePopup, hardenWebContents } from './popup.js'
import { registerHotkeys, unregisterHotkeys, bindingsFor, checkAvailability } from './hotkeys.js'
import { synthesize, toggleOrExplain, flushCaches, explainClickedTranscript } from './session.js'
import { loadConfig, saveConfig, setSecret, hasSecret, getSecret } from '../core/config.js'
import { LLM_PROVIDERS } from '../providers/llm/registry.js'
import { probeProvider } from '../providers/llm/probe.js'
import { isAvailable, getLoadError } from './win32.js'
import { startClickWatcher, stopClickWatcher } from './clicks.js'

const here = dirname(fileURLToPath(import.meta.url))

let tray: Tray | null = null
let settingsWindow: BrowserWindow | null = null
let hotkeysPaused = false

/**
 * The preload is built as CommonJS (index.cjs) so the renderers can run sandboxed.
 * The other names are fallbacks for older build output.
 */
function preloadPath(): string {
  for (const name of ['index.cjs', 'index.mjs', 'index.js']) {
    const candidate = join(here, '../preload', name)
    if (existsSync(candidate)) return candidate
  }
  return join(here, '../preload/index.cjs')
}

const VERIFY_CAPTURE = process.argv.includes('--verify-capture')
const PROBE_HOTKEYS = process.argv.includes('--probe-hotkeys')
const VERIFY_HOTKEYS = process.argv.includes('--verify-hotkeys')
const VERIFY_CLICK = process.argv.includes('--verify-click')

if (VERIFY_CAPTURE) {
  // Self-test mode: skip the single-instance lock and the tray entirely.
  void app.whenReady().then(async () => {
    const { runCaptureVerification } = await import('./verify.js')
    await runCaptureVerification()
  })
} else if (VERIFY_HOTKEYS) {
  void app.whenReady().then(async () => {
    const { runHotkeyVerification } = await import('./verify-hotkeys.js')
    runHotkeyVerification()
  })
} else if (VERIFY_CLICK) {
  void app.whenReady().then(async () => {
    const { runClickVerification } = await import('./verify-click.js')
    await runClickVerification()
  })
} else if (PROBE_HOTKEYS) {
  void app.whenReady().then(async () => {
    const { runHotkeyProbe } = await import('./probe-hotkeys.js')
    runHotkeyProbe()
  })
} else if (!app.requestSingleInstanceLock()) {
  // A second instance would fight over the same global hotkeys, so hand off instead.
  app.quit()
} else {
  app.on('second-instance', () => openSettings())
  void app.whenReady().then(main)
}

function main(): void {
  // This is a tray app: closing the settings window must not quit it, and on Windows
  // there's no dock to hide from.
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  })

  createPopupWindow(preloadPath())
  createTray()
  registerIpc()

  // Nothing works until a model key is pasted, and a new user cannot be expected
  // to find a tray icon. Open Settings on a first run rather than sit there silently.
  if (!hasSecret(loadConfig().llm.provider)) openSettings()
  applyHotkeys()
  applyClickWatcher()

  if (!isAvailable()) {
    // Without the Win32 bindings there is no way to read a selection, so say so
    // plainly at startup rather than letting every hotkey press fail silently.
    void dialog.showMessageBox({
      type: 'error',
      title: 'EasyTranslate',
      message: 'Text capture is unavailable.',
      detail:
        process.platform === 'win32'
          ? `Could not load the Windows input bindings.\n\n${getLoadError() ?? ''}`
          : 'EasyTranslate currently supports Windows only.'
    })
  }
}

// ------------------------------------------------------------ login item

/**
 * Start at login. Installed from source, the executable is a bare electron.exe,
 * which on its own opens Electron's default app — the app directory has to be
 * passed as an argument, the same way the installer's shortcuts do it.
 */
function applyLoginItem(openAtLogin: boolean): void {
  app.setLoginItemSettings({
    openAtLogin,
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()]
  })
}

// ----------------------------------------------------------------- hotkeys

/**
 * Double-clicking a transcript line is the other way in, and it obeys the same
 * pause as the hotkey — "pause" should mean the app does nothing at all.
 */
function applyClickWatcher(): void {
  const wanted = loadConfig().doubleClickTranscripts && !hotkeysPaused && isAvailable()
  if (wanted) startClickWatcher((click) => void explainClickedTranscript(click))
  else stopClickWatcher()
}

function applyHotkeys(announce = true): void {
  if (hotkeysPaused) {
    unregisterHotkeys()
    stopClickWatcher()
    refreshTrayMenu()
    return
  }

  const config = loadConfig()
  const result = registerHotkeys(
    bindingsFor(config, { explain: toggleOrExplain })
  )

  // A reassignment is only useful if it sticks, so persist what actually bound —
  // otherwise the same conflict would be rediscovered on every launch.
  const { explain } = result.resolved
  if (explain && explain !== config.hotkeys.explain) {
    saveConfig({ hotkeys: { explain } })
  }

  refreshTrayMenu()
  if (!announce) return

  if (result.failed.length > 0) {
    void dialog.showMessageBox({
      type: 'warning',
      title: 'EasyTranslate',
      message: 'Some hotkeys could not be registered.',
      detail:
        result.failed.map((f) => `${f.description}: ${f.wanted} — ${f.why}`).join('\n') +
        '\n\nPick a different shortcut in Settings. Run "npm run probe:hotkeys" to list' +
        ' which combinations are free on this machine.',
      buttons: ['Open Settings', 'Ignore'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) openSettings()
    })
  } else if (result.reassigned.length > 0) {
    // Informational, not a warning: everything works, it just moved.
    void dialog.showMessageBox({
      type: 'info',
      title: 'EasyTranslate',
      message: 'Some shortcuts were already in use, so they were moved.',
      detail:
        result.reassigned
          .map((r) => `${r.description}\n    ${r.wanted} was taken  →  now ${r.got}`)
          .join('\n\n') + '\n\nThese are saved. Change them any time in Settings.',
      buttons: ['OK', 'Open Settings'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 1) openSettings()
    })
  }
}

// -------------------------------------------------------------------- tray

function createTray(): void {
  const icon = nativeImage.createFromPath(join(here, '../../resources/tray.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('EasyTranslate')
  tray.on('click', () => openSettings())
  refreshTrayMenu()
}

function refreshTrayMenu(): void {
  if (!tray) return
  const config = loadConfig()

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Explain selection  (${config.hotkeys.explain})`, click: () => toggleOrExplain() },
      { type: 'separator' },
      {
        label: 'Pause',
        type: 'checkbox',
        checked: hotkeysPaused,
        click: (item) => {
          hotkeysPaused = item.checked
          applyHotkeys()
          applyClickWatcher()
        }
      },
      { label: 'Settings…', click: () => openSettings() },
      {
        label: 'Open data folder',
        click: () => void shell.openPath(app.getPath('userData'))
      },
      { type: 'separator' },
      { label: 'Quit EasyTranslate', click: () => app.quit() }
    ])
  )
  tray.setToolTip(hotkeysPaused ? 'EasyTranslate — paused' : 'EasyTranslate')
}

// ---------------------------------------------------------------- settings

function openSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 560,
    height: 720,
    title: 'EasyTranslate Settings',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  hardenWebContents(settingsWindow)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void settingsWindow.loadURL(`${devUrl}/settings/index.html`)
  else void settingsWindow.loadFile(join(here, '../renderer/settings/index.html'))

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

// --------------------------------------------------------------------- ipc

function registerIpc(): void {
  ipcMain.on(IPC.popupClose, () => hidePopup())

  ipcMain.on(IPC.popupResize, (_e, height: unknown) => {
    if (typeof height === 'number' && Number.isFinite(height)) resizePopup(height)
  })

  ipcMain.handle(IPC.ttsSpeak, async (_e, payload: { text?: unknown; slow?: unknown }) => {
    const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
    if (!text) return { error: 'Nothing to read.' }
    try {
      return await synthesize(text, payload?.slow === true)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.configGet, () => ({
    config: loadConfig(),
    providers: LLM_PROVIDERS,
    captureAvailable: isAvailable()
  }))

  ipcMain.handle(IPC.configSet, (_e, patch: Partial<AppConfig>) => {
    const saved = saveConfig(patch ?? {})
    // Hotkeys and the login item are OS-level state, so they have to be re-applied
    // whenever settings change rather than read on demand. No dialog here — Settings
    // reports availability inline as you type.
    applyHotkeys(false)
    applyClickWatcher()
    applyLoginItem(saved.launchAtLogin)
    // Re-read: applyHotkeys may have reassigned a conflicting shortcut and saved
    // again, and Settings must show what is actually bound, not what was requested.
    return loadConfig()
  })

  ipcMain.handle(
    IPC.configSecretSet,
    (_e, payload: { provider: SecretId; value: string }) =>
      setSecret(payload.provider, payload.value ?? '')
  )

  ipcMain.handle(IPC.hotkeyCheck, (_e, accelerator: unknown) =>
    typeof accelerator === 'string'
      ? checkAvailability(accelerator)
      : { ok: false, why: 'Enter a shortcut.' }
  )

  ipcMain.handle(IPC.llmTest, async () => {
    const config = loadConfig()
    return probeProvider(config, getSecret(config.llm.provider))
  })

  ipcMain.handle(IPC.configSecretStatus, () =>
    Object.fromEntries([
      ...LLM_PROVIDERS.map((p) => [p.id, hasSecret(p.id)]),
      ['tts', hasSecret('tts')]
    ])
  )
}

// --------------------------------------------------------------- shutdown

app.on('will-quit', () => {
  unregisterHotkeys()
  stopClickWatcher()
  flushCaches()
})
