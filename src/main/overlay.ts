/**
 * The region-picker window.
 *
 * One full-screen window per display, so a region can be drawn on any monitor. Unlike
 * the explanation popup this one *must* take focus — it needs the Escape key, and it
 * is a deliberate interruption rather than something that appears beside your work.
 */
import { BrowserWindow, screen, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { IPC } from '../shared/types.js'
import { clampToDisplay, isUsableRegion, type Rect, type SnipRegion } from '../core/region.js'
import { hardenWebContents } from './popup.js'

const here = dirname(fileURLToPath(import.meta.url))

let windows: BrowserWindow[] = []
let settle: ((region: SnipRegion | null) => void) | null = null

function closeAll(): void {
  for (const win of windows) {
    if (!win.isDestroyed()) win.destroy()
  }
  windows = []
}

/** Resolve the pending pick exactly once, then tear the overlay down. */
function finish(region: SnipRegion | null): void {
  const resolve = settle
  settle = null
  closeAll()
  resolve?.(region)
}

/**
 * Show the picker and resolve with the chosen region in physical screen pixels,
 * or null if the user cancelled.
 */
export function pickRegion(preloadPath: string): Promise<SnipRegion | null> {
  // A second request supersedes the first rather than stacking overlays.
  if (settle) finish(null)

  return new Promise<SnipRegion | null>((resolve) => {
    settle = resolve

    for (const display of screen.getAllDisplays()) {
      const { x, y, width, height } = display.bounds
      const win = new BrowserWindow({
        x,
        y,
        width,
        height,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        // The opposite of the popup: this one needs keyboard focus for Escape.
        focusable: true,
        hasShadow: false,
        webPreferences: {
          preload: preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          // Which display this overlay covers, so a pick can be attributed to it.
          additionalArguments: [`--display-id=${display.id}`]
        }
      })

      hardenWebContents(win)
      win.setAlwaysOnTop(true, 'screen-saver')

      const devUrl = process.env['ELECTRON_RENDERER_URL']
      if (devUrl) void win.loadURL(`${devUrl}/overlay/index.html`)
      else void win.loadFile(join(here, '../renderer/overlay/index.html'))

      win.once('ready-to-show', () => {
        if (!win.isDestroyed()) {
          win.show()
          win.focus()
        }
      })

      windows.push(win)
    }

    if (windows.length === 0) finish(null)
  })
}

/** Wire the overlay's IPC once at startup. */
export function registerOverlayIpc(): void {
  ipcMain.on(IPC.overlayPick, (event, rect: unknown) => {
    const r = rect as Rect
    if (!r || typeof r.x !== 'number' || !isUsableRegion(r)) {
      finish(null)
      return
    }

    // The rect arrives in window coordinates; the window covers exactly one display,
    // so adding that display's origin gives desktop coordinates.
    const win = BrowserWindow.fromWebContents(event.sender)
    const bounds = win?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 }
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })

    const inDesktopDip: Rect = {
      x: bounds.x + r.x,
      y: bounds.y + r.y,
      width: r.width,
      height: r.height
    }

    const clamped = clampToDisplay(inDesktopDip, display.bounds)

    // Electron's own conversion, not arithmetic of ours: it knows the whole desktop
    // layout, including displays at negative coordinates and mixed scale factors,
    // where a display's physical origin bears no simple relation to its DIP origin.
    const physical = screen.dipToScreenRect(null, clamped)

    finish(
      isUsableRegion(physical) ? { ...physical, displayId: display.id } : null
    )
  })

  ipcMain.on(IPC.overlayCancel, () => finish(null))
}

/** True while the picker is up — used to avoid snipping the overlay itself. */
export function isPicking(): boolean {
  return settle !== null
}
