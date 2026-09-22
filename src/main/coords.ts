/**
 * Screen coordinates, in the one unit the rest of the app uses.
 *
 * Everything to do with pointing at the screen — where the pointer is, where a video
 * sits, which band of pixels to read — is in *physical screen pixels*, because that
 * is what the OS pointing and screen-reading APIs take on both platforms. Electron,
 * meanwhile, talks in device-independent pixels.
 *
 * On Windows those two differ whenever a display is scaled, and Electron provides
 * `dipToScreenPoint` and friends to convert. On macOS they do not differ: Core
 * Graphics coordinates are points, which is exactly what Electron reports, and the
 * backing scale factor never enters into it. Electron marks those conversion calls
 * Windows-only and does not define them elsewhere, so this is where the difference is
 * absorbed and nowhere else.
 */
import { screen, type Rectangle } from 'electron'

interface Point {
  x: number
  y: number
}

const NEEDS_CONVERSION = process.platform === 'win32'

/** Physical screen pixels → the device-independent pixels Electron's windows use. */
export function screenToDip(point: Point): Point {
  return NEEDS_CONVERSION ? screen.screenToDipPoint(point) : point
}

/** Device-independent pixels → the physical screen pixels the OS APIs take. */
export function dipToScreen(point: Point): Point {
  return NEEDS_CONVERSION ? screen.dipToScreenPoint(point) : point
}

/** The same for a rectangle — a display's bounds, in practice. */
export function dipToScreenRect(rect: Rectangle): Rectangle {
  return NEEDS_CONVERSION ? screen.dipToScreenRect(null, rect) : rect
}
