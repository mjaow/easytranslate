import { useEffect, useState } from 'react'
import type { AppConfig, LlmProviderId, TtsProviderId } from '@shared/types'
import { ENDPOINT_PRESETS } from '@shared/presets'
import { toAccelerator, formatAccelerator } from '@shared/accelerator'

interface Bootstrap {
  config: AppConfig
  providers: { id: LlmProviderId; label: string; needsKey: boolean }[]
  captureAvailable: boolean
}

/** A deliberately short list — these are the clearest American voices for learners. */
const AZURE_VOICES = [
  { id: 'en-US-AvaMultilingualNeural', label: 'Ava (female)' },
  { id: 'en-US-AndrewMultilingualNeural', label: 'Andrew (male)' },
  { id: 'en-US-EmmaMultilingualNeural', label: 'Emma (female)' },
  { id: 'en-US-BrianMultilingualNeural', label: 'Brian (male)' },
  { id: 'en-US-JennyNeural', label: 'Jenny (female)' },
  { id: 'en-US-GuyNeural', label: 'Guy (male)' }
]

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <label className="block space-y-1">
      <div className="text-[13px] font-medium">{label}</div>
      {children}
      {hint && (
        <div className="text-[11px] leading-snug" style={{ color: 'var(--text-subtle)' }}>
          {hint}
        </div>
      )}
    </label>
  )
}

function Card({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section
      className="space-y-3 rounded-lg border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-subtle)' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface-muted)',
  borderColor: 'var(--border)',
  color: 'var(--text)'
}
const inputClass = 'w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none'

/**
 * Checks the saved key and model against the endpoint, and on a model mismatch
 * offers the ids that endpoint actually serves.
 *
 * A wrong model id returns an opaque 403 or 404 with no hint at the right spelling,
 * and ids differ between hosts for the very same model. Listing them turns an
 * unguessable error into a click.
 */
function ConnectionTester({
  onPickModel
}: {
  onPickModel: (model: string) => Promise<void>
}): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    ok: boolean
    message: string
    models?: string[]
    modelMissing?: boolean
  } | null>(null)

  const run = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await window.easytranslate.testLlm())
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        onClick={() => void run()}
        disabled={busy}
        className="rounded-md border px-3 py-1.5 text-[13px] font-medium disabled:opacity-40"
        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        {busy ? 'Testing…' : 'Test connection'}
      </button>

      {result && (
        <div
          className="text-[11px] leading-snug"
          style={{ color: result.ok ? 'var(--text-muted)' : 'var(--danger)' }}
        >
          {result.message}
        </div>
      )}

      {result?.modelMissing && result.models && result.models.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px]" style={{ color: 'var(--text-subtle)' }}>
            Available here — click one to use it:
          </div>
          <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
            {result.models.map((m) => (
              <button
                key={m}
                onClick={() => void onPickModel(m).then(() => setResult(null))}
                className="rounded border px-1.5 py-0.5 text-[11px]"
                style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Plays a sample and reports which engine actually produced it.
 *
 * Read-aloud falls back silently when the chosen engine can't be reached, so picking
 * "Edge neural" on a network that blocks it sounds exactly like nothing happened —
 * the Windows voice answers instead and the setting looks broken. This makes the
 * fallback visible at the moment you change the setting, rather than leaving you to
 * infer it.
 */
function VoiceTester({ engine }: { engine: string }): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  // A change of engine invalidates whatever the last test proved.
  useEffect(() => setResult(null), [engine])

  const test = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      const res = await window.easytranslate.speak('He is just grandstanding for the base.', false)
      if (res.error || !res.url) {
        setResult({ ok: false, text: res.error ?? 'No audio was produced.' })
        return
      }
      await new Audio(res.url).play()
      setResult(
        res.fallbackReason
          ? {
              ok: false,
              text: `Fell back to the Windows voice. ${res.fallbackReason}`
            }
          : { ok: true, text: 'Played with the selected engine.' }
      )
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1">
      <button
        onClick={() => void test()}
        disabled={busy}
        className="rounded-md border px-3 py-1.5 text-[13px] font-medium disabled:opacity-40"
        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        {busy ? 'Testing…' : '🔊 Test voice'}
      </button>
      {result && (
        <div
          className="text-[11px] leading-snug"
          style={{ color: result.ok ? 'var(--text-muted)' : 'var(--danger)' }}
        >
          {result.text}
        </div>
      )}
    </div>
  )
}

/**
 * A text field that edits on blur but stays honest about the stored value.
 *
 * These were `defaultValue` inputs, which React reads only once on mount. Picking a
 * preset changed the config underneath while the boxes kept showing the old provider's
 * model and URL — so the UI contradicted what was saved, and blurring a stale box
 * would write that stale value back over a correct one. Syncing on change fixes both.
 */
function DraftInput({
  label,
  hint,
  value,
  placeholder,
  onCommit
}: {
  label: string
  hint?: string
  value: string
  placeholder?: string
  onCommit: (value: string) => Promise<void>
}): React.ReactElement {
  const [draft, setDraft] = useState(value)

  // Whenever the stored value changes (a preset was applied, the provider switched),
  // adopt it — the field is a view of config, not a separate source of truth.
  useEffect(() => setDraft(value), [value])

  return (
    <Field label={label} hint={hint}>
      <input
        className={inputClass}
        style={inputStyle}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) void onCommit(draft)
        }}
      />
    </Field>
  )
}

const IS_MAC = navigator.platform.toUpperCase().includes('MAC')

/**
 * Records a shortcut by listening for the keypress itself.
 *
 * Typing "Control+Alt+E" into a text box asks the user to know Electron's accelerator
 * syntax, and browsers spell-check it into a red squiggle for good measure. Pressing
 * the keys is what everything else does, and it cannot produce invalid syntax.
 *
 * Availability is still checked, because a shortcut another app owns will silently do
 * nothing — the one failure users cannot diagnose for themselves.
 */
function HotkeyRecorder({
  label,
  value,
  onCommit
}: {
  label: string
  value: string
  onCommit: (value: string) => Promise<void>
}): React.ReactElement {
  const [recording, setRecording] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => setMessage(null), [value])

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    // Swallow everything while recording, so Tab and Escape don't act on the form.
    e.preventDefault()
    e.stopPropagation()

    if (e.code === 'Escape') {
      setRecording(false)
      setMessage(null)
      return
    }

    const result = toAccelerator({
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      code: e.code
    })

    if (!result.ok) {
      // A held modifier isn't an error — the user is mid-chord.
      if (result.reason === 'modifier-only') return
      setMessage({
        ok: false,
        text:
          result.reason === 'needs-modifier'
            ? 'Add Ctrl, Alt or Shift — a bare key would be captured everywhere.'
            : 'That key cannot be used as a shortcut.'
      })
      return
    }

    void (async () => {
      const check = await window.easytranslate.checkHotkey(result.accelerator)
      if (!check.ok) {
        setMessage({ ok: false, text: check.why ?? 'That shortcut is unavailable.' })
        return
      }
      setRecording(false)
      await onCommit(result.accelerator)
      setMessage({ ok: true, text: 'Saved.' })
    })()
  }

  return (
    <Field
      label={label}
      hint={recording ? 'Press the keys you want. Escape to cancel.' : undefined}
    >
      <button
        onKeyDown={onKeyDown}
        onClick={() => {
          setRecording(true)
          setMessage(null)
        }}
        onBlur={() => setRecording(false)}
        className="w-full rounded-md border px-2.5 py-1.5 text-left text-[13px] outline-none"
        style={{
          ...inputStyle,
          borderColor: message?.ok === false ? 'var(--danger)' : recording ? 'var(--accent)' : 'var(--border)',
          color: recording ? 'var(--text-subtle)' : 'var(--text)'
        }}
      >
        {recording ? 'Press a shortcut…' : formatAccelerator(value, IS_MAC) || 'Click to set'}
      </button>
      {message && (
        <div
          className="text-[11px] leading-snug"
          style={{ color: message.ok ? 'var(--text-muted)' : 'var(--danger)' }}
        >
          {message.text}
        </div>
      )}
    </Field>
  )
}

export function Settings(): React.ReactElement {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [secrets, setSecrets] = useState<Record<string, boolean>>({})
  const [keyDraft, setKeyDraft] = useState('')
  const [ttsKeyDraft, setTtsKeyDraft] = useState('')
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      setBoot((await window.easytranslate.getConfig()) as unknown as Bootstrap)
      setSecrets(await window.easytranslate.secretStatus())
    })()
  }, [])

  if (!boot) return <div className="p-6 text-[13px]">Loading…</div>
  const { config } = boot

  const patch = async (p: Partial<AppConfig>): Promise<void> => {
    const next = await window.easytranslate.setConfig(p)
    setBoot({ ...boot, config: next })
  }

  const saveKey = async (): Promise<void> => {
    const res = await window.easytranslate.setSecret(config.llm.provider, keyDraft)
    setNote(res.ok ? 'Key saved.' : (res.error ?? 'Could not save the key.'))
    setKeyDraft('')
    setSecrets(await window.easytranslate.secretStatus())
  }

  const saveTtsKey = async (): Promise<void> => {
    await window.easytranslate.setSecret('tts', ttsKeyDraft)
    setTtsKeyDraft('')
    setSecrets(await window.easytranslate.secretStatus())
  }

  const provider = boot.providers.find((p) => p.id === config.llm.provider)

  // A preset is "active" when provider, model and base URL all still match it —
  // edit any field by hand and the picker falls back to Custom, which is honest
  // about what is actually configured.
  const activePreset = ENDPOINT_PRESETS.find(
    (p) =>
      p.provider === config.llm.provider &&
      p.model === config.llm.models[config.llm.provider] &&
      p.baseUrl === config.llm.baseUrls[config.llm.provider]
  )

  const applyPreset = async (id: string): Promise<void> => {
    const preset = ENDPOINT_PRESETS.find((p) => p.id === id)
    if (!preset) return
    await patch({
      llm: {
        ...config.llm,
        provider: preset.provider,
        models: { ...config.llm.models, [preset.provider]: preset.model },
        baseUrls: { ...config.llm.baseUrls, [preset.provider]: preset.baseUrl }
      }
    })
    setNote(null)
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-5 pb-10">
      <header className="space-y-1">
        <h1 className="text-[17px] font-semibold">EasyTranslate</h1>
        <p className="text-[12px] leading-snug" style={{ color: 'var(--text-muted)' }}>
          Select text in any app, press the hotkey, get it explained in English and Chinese.
        </p>
      </header>

      {!boot.captureAvailable && (
        <div
          className="rounded-lg border px-3 py-2 text-[12px]"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
        >
          Text capture is unavailable — the Windows input bindings failed to load.
        </div>
      )}

      <Card title="Hotkeys">
        <HotkeyRecorder
          label="Explain selection"
          value={config.hotkeys.explain}
          onCommit={(v) => patch({ hotkeys: { ...config.hotkeys, explain: v } })}
        />
        <p className="text-[11px] leading-snug" style={{ color: 'var(--text-subtle)' }}>
          Ctrl+C, Ctrl+V and Ctrl+X can never be bound — EasyTranslate will not be the reason a
          copy or paste stops working. If a shortcut you pick is already owned by another app,
          EasyTranslate moves to a free one rather than leaving you with nothing.
        </p>
      </Card>

      <Card title="Explanations">
        <Field
          label="Quick setup"
          hint={activePreset?.note ?? 'Pick a backend, or configure the fields below by hand.'}
        >
          <select
            className={inputClass}
            style={inputStyle}
            value={activePreset?.id ?? ''}
            onChange={(e) => void applyPreset(e.target.value)}
          >
            <option value="">Custom…</option>
            {ENDPOINT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        {activePreset?.keyUrl && !secrets[config.llm.provider] && (
          <button
            onClick={() => window.open(activePreset.keyUrl, '_blank')}
            className="text-[12px] underline"
            style={{ color: 'var(--accent)' }}
          >
            Get a key for {activePreset.label.split(' — ')[0]} →
          </button>
        )}

        <Field label="Provider">
          <select
            className={inputClass}
            style={inputStyle}
            value={config.llm.provider}
            onChange={(e) =>
              void patch({ llm: { ...config.llm, provider: e.target.value as LlmProviderId } })
            }
          >
            {boot.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <DraftInput
          label="Model"
          value={config.llm.models[config.llm.provider] ?? ''}
          hint={
            config.llm.provider === 'claude'
              ? 'e.g. claude-haiku-4-5 (best value) or claude-opus-5 (smartest).'
              : 'The exact model id this endpoint expects, e.g. gemini-3.1-flash-lite.'
          }
          onCommit={(v) =>
            patch({
              llm: { ...config.llm, models: { ...config.llm.models, [config.llm.provider]: v } }
            })
          }
        />

        <DraftInput
          label="Base URL"
          value={config.llm.baseUrls[config.llm.provider] ?? ''}
          hint="Set by the preset. Only change it for a proxy or a local server."
          onCommit={(v) =>
            patch({
              llm: { ...config.llm, baseUrls: { ...config.llm.baseUrls, [config.llm.provider]: v } }
            })
          }
        />

        {provider?.needsKey && (
          <Field
            label="API key"
            hint={
              secrets[config.llm.provider]
                ? 'A key is stored, encrypted by Windows. Type a new one to replace it.'
                : 'Stored encrypted via Windows DPAPI — never written to disk in plain text.'
            }
          >
            <div className="flex gap-2">
              <input
                type="password"
                className={inputClass}
                style={inputStyle}
                placeholder={secrets[config.llm.provider] ? '••••••••••••' : 'Paste your key'}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
              />
              <button
                onClick={() => void saveKey()}
                disabled={!keyDraft}
                className="shrink-0 rounded-md px-3 py-1.5 text-[13px] font-medium disabled:opacity-40"
                style={{ background: 'var(--accent)', color: 'var(--surface)' }}
              >
                Save
              </button>
            </div>
          </Field>
        )}
        {note && (
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {note}
          </div>
        )}

        <ConnectionTester
          onPickModel={(m) =>
            patch({
              llm: { ...config.llm, models: { ...config.llm.models, [config.llm.provider]: m } }
            })
          }
        />
      </Card>

      <Card title="Read aloud">
        <Field
          label="Voice"
          hint={
            config.tts.provider === 'online'
              ? 'Azure neural voices — the same ones behind Edge Read Aloud, over plain HTTPS. Free for 500k characters a month, far more than reading uses.'
              : 'Free and offline, but noticeably robotic. For much better offline quality, install Natural voices: Windows Settings → Accessibility → Narrator → Add natural voices.'
          }
        >
          <select
            className={inputClass}
            style={inputStyle}
            value={config.tts.provider}
            onChange={(e) =>
              void patch({ tts: { ...config.tts, provider: e.target.value as TtsProviderId } })
            }
          >
            <option value="online">Natural voice — Azure, free tier</option>
            <option value="system">Windows voice — free, offline</option>
          </select>
        </Field>

        {config.tts.provider === 'online' && (
          <Field
            label="Azure Speech key"
            hint={
              secrets.tts
                ? 'A key is stored, encrypted by Windows. Type a new one to replace it.'
                : 'From your Speech resource under Keys and Endpoint. Kept separate from the explanation key.'
            }
          >
            <div className="flex gap-2">
              <input
                type="password"
                className={inputClass}
                style={inputStyle}
                placeholder={secrets.tts ? '••••••••••••' : 'Paste your Azure Speech key'}
                value={ttsKeyDraft}
                onChange={(e) => setTtsKeyDraft(e.target.value)}
              />
              <button
                onClick={() => void saveTtsKey()}
                disabled={!ttsKeyDraft}
                className="shrink-0 rounded-md px-3 py-1.5 text-[13px] font-medium disabled:opacity-40"
                style={{ background: 'var(--accent)', color: 'var(--surface)' }}
              >
                Save
              </button>
            </div>
          </Field>
        )}

        {config.tts.provider === 'online' && (
          <div className="grid grid-cols-2 gap-2">
            <DraftInput
              label="Region"
              value={config.tts.azureRegion}
              placeholder="eastus"
              hint="Must match your Speech resource."
              onCommit={(v) => patch({ tts: { ...config.tts, azureRegion: v.trim() } })}
            />
            <Field label="Voice">
              <select
                className={inputClass}
                style={inputStyle}
                value={config.tts.azureVoice}
                onChange={(e) => void patch({ tts: { ...config.tts, azureVoice: e.target.value } })}
              >
                {AZURE_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {config.tts.provider === 'system' && (
          <DraftInput
            label="Windows voice"
            value={config.tts.systemVoice}
            placeholder="e.g. Microsoft Zira"
            hint="Leave blank to pick any American English voice automatically."
            onCommit={(v) => patch({ tts: { ...config.tts, systemVoice: v } })}
          />
        )}

        <VoiceTester
          engine={`${config.tts.provider}:${config.tts.systemVoice}:${config.tts.azureVoice}:${config.tts.azureRegion}`}
        />

        <Field label={`Slow speed: ${config.tts.slowRate}%`} hint="How much the 🐢 button slows playback.">
          <input
            type="range"
            min={-80}
            max={0}
            step={10}
            className="w-full"
            value={config.tts.slowRate}
            onChange={(e) => void patch({ tts: { ...config.tts, slowRate: Number(e.target.value) } })}
          />
        </Field>
      </Card>

      <Card title="General">
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={config.launchAtLogin}
            onChange={(e) => void patch({ launchAtLogin: e.target.checked })}
          />
          Start EasyTranslate when I log in
        </label>
      </Card>

      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-subtle)' }}>
        <strong>How capture works.</strong> Pressing the hotkey briefly borrows your clipboard: it
        saves what is there, sends a copy to the focused app, reads the result, then puts your
        original content back. Text, HTML, rich text and images are all restored. Copied
        <em> files</em> and app-private formats (an Excel cell range, for instance) cannot be
        restored through Electron and would be lost — rare while reading, but worth knowing.
        Apps running as administrator will ignore the hotkey entirely, which Windows enforces and
        no unelevated app can work around.
      </p>
    </div>
  )
}
