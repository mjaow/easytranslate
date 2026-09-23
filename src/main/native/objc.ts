/**
 * Just enough of the Objective-C runtime and Core Foundation to reach the macOS
 * APIs that have no C surface — NSPasteboard's change counter, and an NSPanel's
 * style mask.
 *
 * `objc_msgSend` is the whole runtime: every Objective-C call is one. Apple's
 * headers declare it variadic, but it is not, and on arm64 a variadic call uses a
 * different convention — so it must be called through a prototype with the exact
 * argument count, which is what the msgSend* family below is for. They all name the
 * same symbol; koffi binds each to its own arity and return type.
 *
 * Every object is passed as an opaque pointer, so nothing here has to know an
 * Objective-C type, and koffi hands back `null` for nil.
 */
import koffi from 'koffi'

/** Opaque Objective-C object, Core Foundation reference, or selector. */
export type Ref = unknown

interface ObjcBindings {
  getClass: (name: string) => Ref
  sel: (name: string) => Ref
  msgSend0: (self: Ref, op: Ref) => Ref
  msgSendInt: (self: Ref, op: Ref) => number
  msgSendBool: (self: Ref, op: Ref, a: Ref) => boolean
  msgSendFlag: (self: Ref, op: Ref) => boolean
  /**
   * The same call with the receiver given as a raw address, for an object that
   * arrived as a pointer value inside a Buffer rather than as a koffi pointer —
   * which is how Electron hands over a native window handle.
   */
  msgSendAt: (self: bigint, op: Ref) => Ref
  release: (obj: Ref) => void
  stringCreate: (alloc: Ref, text: string, encoding: number) => Ref
  stringGetCString: (s: Ref, buffer: Buffer, size: number, encoding: number) => boolean
}

const kCFStringEncodingUTF8 = 0x08000100

let cached: ObjcBindings | null = null
let attempted = false

export function objc(): ObjcBindings | null {
  if (attempted) return cached
  attempted = true

  try {
    // AppKit is already loaded inside Electron's main process; loading it here as
    // well is a no-op there and is what makes the bindings usable from a bare node
    // process, which the unit tests need.
    try {
      koffi.load('/System/Library/Frameworks/AppKit.framework/AppKit')
    } catch {
      // A machine without AppKit is not a Mac we can serve, but the failure belongs
      // to whichever call needs it, not to loading the runtime.
    }

    const runtime = koffi.load('/usr/lib/libobjc.A.dylib')
    const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')

    cached = {
      getClass: runtime.func('objc_getClass', 'void *', ['str']),
      sel: runtime.func('sel_registerName', 'void *', ['str']),
      msgSend0: runtime.func('objc_msgSend', 'void *', ['void *', 'void *']),
      msgSendInt: runtime.func('objc_msgSend', 'int64', ['void *', 'void *']),
      msgSendBool: runtime.func('objc_msgSend', 'bool', ['void *', 'void *', 'void *']),
      msgSendFlag: runtime.func('objc_msgSend', 'bool', ['void *', 'void *']),
      msgSendAt: runtime.func('objc_msgSend', 'void *', ['intptr', 'void *']),
      release: cf.func('CFRelease', 'void', ['void *']),
      stringCreate: cf.func('CFStringCreateWithCString', 'void *', ['void *', 'str', 'uint32']),
      stringGetCString: cf.func('CFStringGetCString', 'bool', ['void *', 'char *', 'int64', 'uint32'])
    }
    return cached
  } catch (err) {
    console.error('[objc] could not load the Objective-C runtime:', err)
    cached = null
    return null
  }
}

/** A CFString the caller owns and must release. Null when the runtime is missing. */
export function cfString(text: string): Ref {
  const o = objc()
  return o ? o.stringCreate(null, text, kCFStringEncodingUTF8) : null
}

/** Read a CFString back into JS. Empty string for nil or anything unreadable. */
export function cfStringToJs(value: Ref, max = 4096): string {
  const o = objc()
  if (!o || !value) return ''
  const buffer = Buffer.alloc(max)
  if (!o.stringGetCString(value, buffer, max, kCFStringEncodingUTF8)) return ''
  const end = buffer.indexOf(0)
  return buffer.toString('utf8', 0, end < 0 ? max : end)
}
