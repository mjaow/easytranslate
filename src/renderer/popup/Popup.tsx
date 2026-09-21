import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExplainState } from '@shared/types'
import { parseNotable, parseConcept } from '@core/notable'
import { playAudio, stopAudio } from './player'

/**
 * The English half of an example.
 *
 * The model returns the sentence then its Chinese translation on the next line.
 * Only the first line should be spoken — an American English voice handed Chinese
 * text produces nonsense.
 */
function exampleEnglish(example: string): string {
  return example.split('\n')[0]?.trim() ?? ''
}

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
  compact = false,
  onStatus
}: {
  text: string
  slow?: boolean
  compact?: boolean
  onStatus: (msg: string | null) => void
}): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)

  const click = useCallback(async () => {
    // While this clip is playing the button becomes a stop button — a long passage
    // is exactly when you want to cut it short.
    if (playing) {
      stopAudio()
      return
    }
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
      setPlaying(true)
      await playAudio(res.url, () => setPlaying(false))
    } catch (err) {
      setPlaying(false)
      onStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [busy, playing, text, slow, onStatus])

  const label = playing ? 'Stop' : slow ? 'Read slowly' : 'Read aloud'

  return (
    <button
      onClick={() => void click()}
      // Never disabled while playing, or there would be no way to stop it.
      disabled={busy && !playing}
      title={label}
      aria-label={label}
      className={`rounded-md leading-none transition-colors disabled:opacity-40 ${
        compact ? 'px-1 py-0.5 text-[11px]' : 'px-1.5 py-1 text-[13px]'
      }`}
      style={{ color: playing ? 'var(--accent)' : 'var(--text-muted)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-muted)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {playing ? '⏹' : slow ? '🐢' : '🔊'}
    </button>
  )
}

function Section({
  label,
  action,
  children
}: {
  label?: string
  action?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="space-y-0.5">
      {(label || action) && (
        <div className="flex items-center gap-1">
          <div
            className="text-[10px] font-medium uppercase tracking-wider"
            style={{ color: 'var(--text-subtle)' }}
          >
            {label}
          </div>
          {action}
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
      // A new lookup replaces the old one, so its audio should not linger.
      stopAudio()
      setState(next)
      setStatus(null)
    })
  }, [])

  // The window only hides, it is never destroyed, so playback has to be stopped
  // explicitly when it goes away.
  useEffect(() => window.easytranslate.onStopAudio(() => stopAudio()), [])

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
  const isCode = mode === 'code'
  // The model's verdict on the ordinary answer: offer the code explanation as a step.
  const offerCode = !isCode && ex.isCode === true
  // A snippet's headline is its first line: twelve lines of code must not become a
  // twelve-line header.
  const shaped = state.raw ?? state.text
  const firstLine = shaped.split('\n')[0] ?? ''
  const headline = isCode
    ? `${firstLine.slice(0, 70)}${firstLine.length > 70 || shaped.includes('\n') ? '…' : ''}`
    : isWord || state.text.length <= 90
      ? state.text
      : `${state.text.slice(0, 90)}…`
  const empty = Object.keys(ex).length === 0

  return (
    // The window is sized to the content up to a limit; past it, this scrolls.
    <div className="p-1.5" style={{ maxHeight: '100vh', overflowY: 'auto' }}>
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
            <div className={`font-semibold leading-snug ${isCode ? 'font-mono text-[12px]' : 'text-[14px]'}`}>
              {headline || 'EasyTranslate'}
            </div>
            {/* One quiet line: the language for code, IPA and part of speech for a word,
                and always which model answered — so the source of an answer is never
                a mystery, and a stale cache entry says so. */}
            {(ex.lang || (isWord && (ex.ipa || ex.pos)) || state.model) && (
              <div
                className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[11px]"
                style={{ color: 'var(--text-muted)' }}
              >
                {isCode && ex.lang && <span className="italic">{ex.lang}</span>}
                {isWord && ex.ipa && <span className="font-mono">{ex.ipa}</span>}
                {isWord && ex.pos && <span className="italic">{ex.pos}</span>}
                {state.model && (
                  <span
                    className="ml-auto text-[10px]"
                    style={{ color: 'var(--text-subtle)' }}
                    title={state.cached ? 'Served from the cache of an earlier answer' : 'The model that answered'}
                  >
                    {state.model}
                    {state.cached ? ' · cached' : ''}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center">
            {/* Code is not read aloud; the English explanation below has its own button. */}
            {!isCode && <SpeakButton text={state.text} onStatus={setStatus} />}
            {!isCode && <SpeakButton text={state.text} slow onStatus={setStatus} />}
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

              {offerCode && (
                <button
                  onClick={() => window.easytranslate.explainAsCode()}
                  className="w-full rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium"
                  style={{ background: 'var(--accent)', color: 'var(--surface)' }}
                >
                  This looks like code — explain what it does
                </button>
              )}

              {ex.zh && <div className="text-[15px] font-medium leading-snug">{ex.zh}</div>}
              {ex.en && (
                <Section
                  label="in plain english"
                  action={<SpeakButton text={ex.en} compact onStatus={setStatus} />}
                >
                  <span style={{ color: 'var(--text-muted)' }}>{ex.en}</span>
                </Section>
              )}
              {ex.here && (
                <Section label="in context">
                  <span style={{ color: 'var(--text)' }}>{ex.here}</span>
                </Section>
              )}
              {ex.example && (
                <Section
                  label="example"
                  action={
                    <>
                      <SpeakButton text={exampleEnglish(ex.example)} compact onStatus={setStatus} />
                      <SpeakButton
                        text={exampleEnglish(ex.example)}
                        slow
                        compact
                        onStatus={setStatus}
                      />
                    </>
                  }
                >
                  {ex.example.split('\n').map((line, i) => (
                    <div key={i} style={{ color: i === 0 ? 'var(--text)' : 'var(--text-muted)' }}>
                      {line}
                    </div>
                  ))}
                </Section>
              )}
              {ex.why && (
                <Section label="why it matters">
                  <span style={{ color: 'var(--text)', whiteSpace: 'pre-line' }}>{ex.why}</span>
                </Section>
              )}
              {ex.steps && ex.steps.length > 0 && (
                <Section label="step by step">
                  <ol className="space-y-0.5 pl-4" style={{ listStyle: 'decimal' }}>
                    {ex.steps.map((step, i) => (
                      <li key={i} style={{ color: 'var(--text)' }}>
                        {step}
                      </li>
                    ))}
                  </ol>
                </Section>
              )}
              {ex.design && ex.design.length > 0 && (
                <Section label="why it is written this way">
                  <ul className="space-y-1 pl-4" style={{ listStyle: 'disc' }}>
                    {ex.design.map((line, i) => (
                      <li key={i} style={{ color: 'var(--text)' }}>
                        {line}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {ex.issues && ex.issues.length > 0 && (
                <Section label="watch out">
                  <ul className="space-y-1 pl-4" style={{ listStyle: 'disc' }}>
                    {ex.issues.map((line, i) => (
                      <li key={i} style={{ color: 'var(--danger)' }}>
                        {line}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {ex.concepts && ex.concepts.length > 0 && (
                <Section label="concepts worth knowing">
                  <ul className="space-y-1">
                    {ex.concepts.map((item, i) => {
                      const c = parseConcept(item)
                      if (!c) return null
                      return (
                        <li key={i} className="flex items-baseline gap-1.5">
                          <span className="font-mono text-[12px] font-medium" style={{ color: 'var(--text)' }}>
                            {c.term}
                          </span>
                          <SpeakButton text={c.term} compact onStatus={setStatus} />
                          {c.detail && <span style={{ color: 'var(--text-muted)' }}>{c.detail}</span>}
                        </li>
                      )
                    })}
                  </ul>
                </Section>
              )}
              {ex.notable && ex.notable.length > 0 && (
                <Section label="words worth knowing">
                  <ul className="space-y-1">
                    {ex.notable.map((item, i) => {
                      const t = parseNotable(item)
                      if (!t) return null
                      return (
                        <li key={i}>
                          <div className="flex items-baseline gap-1.5">
                            <span className="font-medium" style={{ color: 'var(--text)' }}>
                              {t.term}
                            </span>
                            {t.ipa && (
                              <span
                                className="font-mono text-[11px]"
                                style={{ color: 'var(--text-subtle)' }}
                              >
                                {t.ipa}
                              </span>
                            )}
                            <SpeakButton text={t.term} compact onStatus={setStatus} />
                            {t.gloss && (
                              <span style={{ color: 'var(--text-muted)' }}>{t.gloss}</span>
                            )}
                          </div>
                          {t.example && (
                            <div className="flex items-baseline gap-1 pl-2 text-[12px]">
                              <span className="italic" style={{ color: 'var(--text-subtle)' }}>
                                {t.example}
                              </span>
                              <SpeakButton text={t.example} compact onStatus={setStatus} />
                            </div>
                          )}
                        </li>
                      )
                    })}
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
