/**
 * The macOS Accessibility API, through koffi.
 *
 * This is the counterpart of UI Automation on Windows: it names the window in front,
 * and it reports what an application has drawn at a point on screen. Both are plain
 * C, so unlike the Windows side there is no script to shell out to — the read happens
 * in process, which is also why it is fast enough to sit behind a double-click.
 *
 * Everything here needs the Accessibility permission. Without it each call returns
 * kAXErrorAPIDisabled and the helpers below answer null, which every caller already
 * treats as "nothing there".
 */
import koffi from 'koffi'
import { cfString, cfStringToJs, objc, type Ref } from './objc.js'

export type { Ref } from './objc.js'

/** kAXValueType constants — what an AXValue is wrapping. */
const kAXValueTypeCGPoint = 1
const kAXValueTypeCGSize = 2

const CGPointStruct = koffi.struct('AXCGPoint', { x: 'double', y: 'double' })
const CGSizeStruct = koffi.struct('AXCGSize', { width: 'double', height: 'double' })

interface AxBindings {
  createSystemWide: () => Ref
  createApplication: (pid: number) => Ref
  copyAttributeValue: (element: Ref, attr: Ref, out: Ref[]) => number
  copyElementAtPosition: (element: Ref, x: number, y: number, out: Ref[]) => number
  valueGetPoint: (value: Ref, type: number, out: { x: number; y: number }[]) => boolean
  valueGetSize: (value: Ref, type: number, out: { width: number; height: number }[]) => boolean
  isTrusted: () => boolean
  arrayGetCount: (array: Ref) => number
  arrayGetValueAtIndex: (array: Ref, index: number) => Ref
  getTypeID: (obj: Ref) => number
  stringTypeID: () => number
  arrayTypeID: () => number
  elementTypeID: () => number
}

let cached: AxBindings | null = null
let attempted = false

function ax(): AxBindings | null {
  if (attempted) return cached
  attempted = true
  try {
    const services = koffi.load(
      '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices'
    )
    const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')

    cached = {
      createSystemWide: services.func('AXUIElementCreateSystemWide', 'void *', []),
      createApplication: services.func('AXUIElementCreateApplication', 'void *', ['int32']),
      copyAttributeValue: services.func('AXUIElementCopyAttributeValue', 'int32', [
        'void *',
        'void *',
        koffi.out(koffi.pointer('void *'))
      ]),
      copyElementAtPosition: services.func('AXUIElementCopyElementAtPosition', 'int32', [
        'void *',
        'float',
        'float',
        koffi.out(koffi.pointer('void *'))
      ]),
      valueGetPoint: services.func('AXValueGetValue', 'bool', [
        'void *',
        'uint32',
        koffi.out(koffi.pointer(CGPointStruct))
      ]),
      valueGetSize: services.func('AXValueGetValue', 'bool', [
        'void *',
        'uint32',
        koffi.out(koffi.pointer(CGSizeStruct))
      ]),
      isTrusted: services.func('AXIsProcessTrusted', 'bool', []),
      arrayGetCount: cf.func('CFArrayGetCount', 'int64', ['void *']),
      arrayGetValueAtIndex: cf.func('CFArrayGetValueAtIndex', 'void *', ['void *', 'int64']),
      getTypeID: cf.func('CFGetTypeID', 'uint64', ['void *']),
      stringTypeID: cf.func('CFStringGetTypeID', 'uint64', []),
      arrayTypeID: cf.func('CFArrayGetTypeID', 'uint64', []),
      elementTypeID: services.func('AXUIElementGetTypeID', 'uint64', [])
    }
    return cached
  } catch (err) {
    console.error('[ax] could not load the Accessibility bindings:', err)
    cached = null
    return null
  }
}

export function axAvailable(): boolean {
  return ax() !== null
}

/** Whether this process is allowed to read other apps' accessibility trees. */
export function axTrusted(): boolean {
  const a = ax()
  if (!a) return false
  try {
    return a.isTrusted()
  } catch {
    return false
  }
}

/** The system-wide accessibility element: the root a point is looked up from. */
function systemWide(): Ref {
  const a = ax()
  return a ? a.createSystemWide() : null
}

/**
 * One attribute of an element. The caller owns the result and must release it.
 * Null whenever the attribute is absent, which is the ordinary case.
 */
export function copyAttribute(element: Ref, name: string): Ref {
  const a = ax()
  const o = objc()
  if (!a || !o || !element) return null
  const key = cfString(name)
  if (!key) return null
  try {
    const out: Ref[] = [null]
    const err = a.copyAttributeValue(element, key, out)
    return err === 0 ? out[0] : null
  } catch {
    return null
  } finally {
    o.release(key)
  }
}

/** An attribute read as text. Empty string when it is absent or not a string. */
export function attributeString(element: Ref, name: string): string {
  const a = ax()
  const o = objc()
  if (!a || !o) return ''
  const value = copyAttribute(element, name)
  if (!value) return ''
  try {
    return a.getTypeID(value) === a.stringTypeID() ? cfStringToJs(value) : ''
  } finally {
    o.release(value)
  }
}

/** An attribute read as an element. The caller must release it. */
export function attributeElement(element: Ref, name: string): Ref {
  const a = ax()
  const o = objc()
  if (!a || !o) return null
  const value = copyAttribute(element, name)
  if (!value) return null
  if (a.getTypeID(value) === a.elementTypeID()) return value
  o.release(value)
  return null
}

/**
 * Walk an attribute that holds a list of elements, reading each one.
 *
 * `CFArrayGetValueAtIndex` hands back a borrowed reference that dies with the array,
 * so the array is held for the whole walk and the caller reads what it needs inside
 * `fn` rather than being given references that would already be gone.
 */
export function mapAttributeElements<T>(
  element: Ref,
  name: string,
  fn: (child: Ref) => T,
  limit = 512
): T[] {
  const a = ax()
  if (!a) return []
  const value = copyAttribute(element, name)
  if (!value) return []
  try {
    if (a.getTypeID(value) !== a.arrayTypeID()) return []
    const count = Math.min(Number(a.arrayGetCount(value)), limit)
    const out: T[] = []
    for (let i = 0; i < count; i++) {
      const child = a.arrayGetValueAtIndex(value, i)
      if (child) out.push(fn(child))
    }
    return out
  } finally {
    release(value)
  }
}

/**
 * An attribute that holds a list of strings — Chromium's AXDOMClassList is one.
 * Read inside the array's lifetime, for the same reason as mapAttributeElements.
 */
export function attributeStringList(element: Ref, name: string): string[] {
  const a = ax()
  if (!a) return []
  return mapAttributeElements(element, name, (child) =>
    a.getTypeID(child) === a.stringTypeID() ? cfStringToJs(child, 512) : ''
  ).filter(Boolean)
}

export function release(obj: Ref): void {
  const o = objc()
  if (o && obj) {
    try {
      o.release(obj)
    } catch {
      // Releasing something already gone must never take the app down.
    }
  }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** An element's on-screen rectangle, in points (which on macOS are screen pixels). */
export function elementRect(element: Ref): Rect | null {
  const a = ax()
  if (!a || !element) return null
  const positionValue = copyAttribute(element, 'AXPosition')
  const sizeValue = copyAttribute(element, 'AXSize')
  try {
    if (!positionValue || !sizeValue) return null
    const point = [{ x: 0, y: 0 }]
    const size = [{ width: 0, height: 0 }]
    if (!a.valueGetPoint(positionValue, kAXValueTypeCGPoint, point)) return null
    if (!a.valueGetSize(sizeValue, kAXValueTypeCGSize, size)) return null
    if (!(size[0].width > 0) || !(size[0].height > 0)) return null
    return { x: point[0].x, y: point[0].y, width: size[0].width, height: size[0].height }
  } finally {
    release(positionValue)
    release(sizeValue)
  }
}

/** The deepest element the pointer is over. The caller must release it. */
export function elementAtPoint(x: number, y: number): Ref {
  const a = ax()
  if (!a) return null
  const root = systemWide()
  if (!root) return null
  try {
    const out: Ref[] = [null]
    const err = a.copyElementAtPosition(root, x, y, out)
    return err === 0 ? out[0] : null
  } catch {
    return null
  } finally {
    release(root)
  }
}

/**
 * Title of the focused window of the frontmost application.
 *
 * A browser sets this to its active tab's title, which is the property the
 * double-click watcher relies on — the same as GetWindowTextW on Windows.
 *
 * The obvious route, asking the system-wide element for AXFocusedApplication, does
 * not work: it answers kAXErrorAPIDisabled even for a fully trusted process. So the
 * frontmost application is taken from NSWorkspace and its own accessibility element
 * is built from its pid, which answers normally.
 */
export function focusedWindowTitle(): string {
  const a = ax()
  const o = objc()
  if (!a || !o) return ''

  let application: Ref = null
  let window: Ref = null
  try {
    const workspace = o.getClass('NSWorkspace')
    if (!workspace) return ''
    const shared = o.msgSend0(workspace, o.sel('sharedWorkspace'))
    const front = shared ? o.msgSend0(shared, o.sel('frontmostApplication')) : null
    if (!front) return ''
    const pid = Number(o.msgSendInt(front, o.sel('processIdentifier')))
    if (!Number.isFinite(pid) || pid <= 0) return ''

    application = a.createApplication(pid)
    if (!application) return ''
    window = attributeElement(application, 'AXFocusedWindow') ?? attributeElement(application, 'AXMainWindow')
    return window ? attributeString(window, 'AXTitle') : ''
  } catch {
    return ''
  } finally {
    release(window)
    release(application)
  }
}
