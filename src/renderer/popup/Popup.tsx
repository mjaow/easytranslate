import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExplainState } from '@shared/types'

/** Feels like "still working" rather than "broken" while the first tokens land. */
function Skeleton(): React.ReactElement {
  return (
    <div className="et-pulse space-y-2 py-1">
      <div className="h-3 w-3/4 rounded" style={{ background: 'var(--border)' }} />
      <div className="h-3 w-1/2 rounded" style={{ background: 'var(--border)' }} />
    </div>
  )
}

function SpeakButton({
  text,
  slow = false,
  onStatus
}: {
  text: string
  slow?: boolean
  onStatus: (msg: string | null) => void
}): React.ReactElement {
  const [busy, setBusy] = useState(false)

  const play = useCallback(async () => {
    if (busy || !text.trim()) return
    setBusy(true)
    onStatus(null)
    try {
      const res = await window.easytranslate.speak(text, slow)
      if (res.error || !res.url) {
        onStatus(res.error ?? 'Could not read that aloud.')
        return
      }
      if (res.fallbackReason) onStatus('Using the Windows voice — the online voice is unavailable.')
      const audio = new Audio(res.url)
      await audio.play()
    } catch (err) {
      onStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [busy, text, slow, onStatus])

  return (
    <button
      onClick={() => void play()}
      disabled={busy}
      title={slow ? 'Read slowly' : 'Read aloud'}
      className="rounded-md px-1.5 py-1 text-[13px] leading-none transition-colors disabled:opacity-40"
      style={{ color: 'var(--text-muted)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-muted)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {slow ? '🐢' : '🔊'}
    </button>
  )
}

function Section({
  label,
  children
}: {
  label?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="space-y-0.5">
      {label && (
        <div
          className="text-[10px] font-medium uppercase tracking-wider"
          style={{ color: 'var(--text-subtle)' }}
        >
          {label}
        </div>
      )}
      <div className="text-[13px] leading-snug">{children}</div>
    </div>
  )
}

export function Popup(): React.ReactElement | null {
  const [state, setState] = useState<ExplainState | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return window.easytranslate.onUpdate(({ state: next }) => {
      setState(next)
      setStatus(null)
    })
  }, [])

  // Size the window to whatever the content actually needs.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const report = (): void => window.easytranslate.resize(el.getBoundingClientRect().height + 2)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [state])

  if (!state) return null

  const { explanation: ex, mode } = state
  const isWord = mode === 'word'
  const headline =
    isWord || state.text.length <= 90 ? state.text : `${state.text.slice(0, 90)}…`
  const empty = Object.keys(ex).length === 0

  return (
    <div className="p-1.5">
      <div
        ref={contentRef}
        className="overflow-hidden rounded-xl border"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          boxShadow: 'var(--shadow)'
        }}
      >
        {/* ---------------------------------------------------------- header */}
        <div
          className="flex items-start gap-1.5 border-b px-3 py-2"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)' }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold leading-snug">
              {headline || 'EasyTranslate'}
            </div>
            {isWord && (ex.ipa || ex.pos) && (
              <div
                className="mt-0.5 flex items-baseline gap-2 text-[11px]"
                style={{ color: 'var(--text-muted)' }}
              >
                {ex.ipa && <span className="font-mono">{ex.ipa}</span>}
                {ex.pos && <span className="italic">{ex.pos}</span>}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center">
            <SpeakButton text={state.text} onStatus={setStatus} />
            <SpeakButton text={state.text} slow onStatus={setStatus} />
            <button
              onClick={() => window.easytranslate.close()}
              title="Close (Esc)"
              className="rounded-md px-1.5 py-1 text-[13px] leading-none"
              style={{ color: 'var(--text-subtle)' }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------------ body */}
        <div className="space-y-2.5 px-3 py-2.5">
          {state.status === 'error' ? (
            <div className="text-[13px] leading-snug" style={{ color: 'var(--danger)' }}>
              {state.error}
            </div>
          ) : (
            <>
              {empty && state.status === 'streaming' && <Skeleton />}

              {ex.zh && <div className="text-[15px] font-medium leading-snug">{ex.zh}</div>}
              {ex.en && (
                <Section>
                  <span style={{ color: 'var(--text-muted)' }}>{ex.en}</span>
                </Section>
              )}
              {ex.here && (
                <Section label="in context">
                  <span style={{ color: 'var(--text)' }}>{ex.here}</span>
                </Section>
              )}
              {ex.example && (
                <Section label="example">
                  {ex.example.split('\n').map((line, i) => (
                    <div key={i} style={{ color: i === 0 ? 'var(--text)' : 'var(--text-muted)' }}>
                      {line}
                    </div>
                  ))}
                </Section>
              )}
              {ex.notable && ex.notable.length > 0 && (
                <Section label="worth knowing">
                  <ul className="space-y-0.5">
                    {ex.notable.map((item, i) => (
                      <li key={i} style={{ color: 'var(--text-muted)' }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </>
          )}

          {status && (
            <div className="text-[11px]" style={{ color: 'var(--text-subtle)' }}>
              {status}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
