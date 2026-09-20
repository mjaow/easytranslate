import { useCallback, useEffect, useRef, useState } from 'react'
import { rectFromDrag, isUsableRegion, type Rect } from '@core/region'

/**
 * The region picker: a dimmed sheet covering one display, on which you drag a box.
 *
 * The chosen rectangle is reported in the window's own coordinates. Main adds the
 * display origin and converts to physical pixels — the overlay deliberately knows
 * nothing about scale factors or monitor layout.
 */
export function Overlay(): React.ReactElement {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const committed = useRef(false)

  const cancel = useCallback(() => {
    if (committed.current) return
    committed.current = true
    window.easytranslate.overlayCancel()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // Deliberately NOT cancelling on blur. One overlay is created per display, and
    // only one of them can hold focus — the others blur the moment it is taken, so
    // treating blur as cancel made the picker close itself instantly on any
    // multi-monitor setup. Escape is handled globally by main instead, which works
    // whichever window has focus.
  }, [cancel])

  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    setStart({ x: e.clientX, y: e.clientY })
    setRect(null)
  }

  const onMouseMove = (e: React.MouseEvent): void => {
    if (!start) return
    setRect(rectFromDrag(start, { x: e.clientX, y: e.clientY }))
  }

  const onMouseUp = (e: React.MouseEvent): void => {
    if (!start || committed.current) return
    const final = rectFromDrag(start, { x: e.clientX, y: e.clientY })
    setStart(null)

    // A click without a drag is almost always a mis-click, not a request to read a
    // few pixels — treat it as cancelling rather than returning nonsense.
    if (!isUsableRegion(final)) {
      cancel()
      return
    }
    committed.current = true
    window.easytranslate.overlayPick(final)
  }

  return (
    <div
      className="relative h-screen w-screen"
      style={{ background: 'rgba(0, 0, 0, 0.35)' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {!start && !rect && (
        <div className="pointer-events-none flex h-full w-full items-center justify-center">
          <div
            className="rounded-lg px-4 py-2 text-[14px] font-medium"
            style={{ background: 'rgba(0,0,0,0.75)', color: '#fff' }}
          >
            Drag a box over the text — Esc to cancel
          </div>
        </div>
      )}

      {rect && (
        <>
          {/* Punch the selection out of the dim sheet so the content reads clearly. */}
          <div
            className="pointer-events-none absolute"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              background: 'transparent',
              outline: '2px solid #a5b4fc',
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.35)'
            }}
          />
          <div
            className="pointer-events-none absolute font-mono text-[11px]"
            style={{
              left: rect.x,
              top: Math.max(0, rect.y - 20),
              color: '#fff',
              textShadow: '0 1px 3px rgba(0,0,0,0.9)'
            }}
          >
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </>
      )}
    </div>
  )
}
