# EasyTranslate

Select text in **any** Windows app, press a hotkey, and get it explained in English and
Chinese — with American-accent read-aloud. Works in Edge, Chrome, the ChatGPT desktop
app, Teams, PDFs, VS Code, anywhere.

> **It will not break your copy and paste.** That is a design constraint, not a hope —
> see [The copy-safety contract](#the-copy-safety-contract).

---

## Why this isn't a browser extension

Two things make extensions the wrong shape for this:

1. **They break your copy.** To offer click-to-translate, an extension must attach
   `mouseup`/`selectionchange` listeners and inject overlay DOM next to your selection.
   That overlay takes focus and collapses the selection, so your own Ctrl+C grabs
   nothing. It's inherent to the approach, not a bug in any particular extension.
2. **They only live in one browser.** They don't reach the ChatGPT app, Teams, PDF
   readers or VS Code at all — those aren't web pages.

EasyTranslate runs *outside* every app, driven by a global hotkey. Nothing of ours ever
enters a page, so it is structurally incapable of interfering with your selection. And
working at the OS level makes "works everywhere" free rather than hard.

---

## How it works

```
  select text anywhere            (we are not involved — your normal selection)
            ↓
  press Ctrl+Alt+E                (global hotkey)
            ↓
  snapshot clipboard (text / HTML / RTF / image)
  read GetClipboardSequenceNumber()
            ↓
  SendInput: a clean Ctrl+C to the focused window
            ↓
  poll the sequence number every 10ms, up to 700ms — retry once if nothing
            ↓
  read the copied text
            ↓
  restore your original clipboard
            ↓
  show a non-activating popup at the cursor and stream the explanation in
```

Two details do the heavy lifting:

**Watching the clipboard sequence number instead of sleeping.** A blind `sleep(300)` is
slower than necessary on fast apps, unreliable on slow ones, and can't distinguish "this
app is slow" from "this app ignored Ctrl+C" — a distinction needed to show a useful
error. Measured round trip: **23ms**.

**Sending the copy twice if the first goes unanswered.** Found the hard way on a
wsj.com article: capture failed there while a manual Ctrl+C worked fine. The page
wasn't blocking anything — it was heavy enough with ad scripts that its main thread
missed a 600ms deadline. One retry inside a 700ms window fixed it. The cost is paid
only when something is genuinely wrong, and a false "nothing is selected" is far more
annoying than an extra second.

**Releasing modifiers before copying.** The hotkey is itself a chord, so when it fires
the user is still physically holding Ctrl and Alt. A naive Ctrl+C would arrive as
Ctrl+Alt+C and copy nothing. `sendCopy()` synthesises key-ups for every held modifier
first, then sends the copy — all in one `SendInput` batch, which Windows guarantees
won't be interleaved with other input.

### Select what you want explained

Selections of three words or fewer are treated as a term and get IPA, part of speech
and a contextual gloss. Anything longer is treated as a passage: a natural Chinese
translation, a simpler-English restatement, and any idioms worth knowing.

An earlier version split passages into clickable word chips so any word could be
drilled into. It was removed: selecting the text you want is more direct than picking
it out of a grid afterwards.

---

## The copy-safety contract

These are testable rules the implementation holds to:

1. **No content scripts, no injected DOM, no page listeners.** Your selection is never
   touched.
2. **The clipboard is always restored** — text, HTML, RTF and images, typically within
   ~150ms.
3. **The popup never takes focus**, so the source app keeps it, your selection stays
   highlighted, and your own Ctrl+C / Ctrl+V keep working while the popup is open.
4. **Ctrl+C, Ctrl+V and Ctrl+X can never be bound**, whatever the config says
   (`FORBIDDEN` in `src/main/hotkeys.ts`).

Rule 3 needs more than Electron provides. `focusable: false` is
[unreliable on Windows](https://github.com/electron/electron/issues/11049) — windows
still steal focus on `show()`. So the popup is created with `focusable: false`, shown
with `showInactive()`, **and** has `WS_EX_NOACTIVATE` stamped onto its HWND directly via
koffi. `makeNonActivating()` reads the style back to confirm it stuck rather than
trusting the setter.

---

## Getting started

**Requirements:** Windows 10 or 11, and [Node.js](https://nodejs.org) 20 or newer.
(Windows only for now — see [Platform support](#platform-support).)

```bash
git clone https://github.com/mjaow/easytranslate.git
cd easytranslate
npm install
npm start
```

`npm start` builds and launches the app. It lives in the **system tray** — look for the
two-tone circle near the clock, under the `^` if Windows has hidden it. There is no main
window; that is deliberate.

For development with hot reload, use `npm run dev` instead.

### Then configure it

Right-click the tray icon → **Settings…**

1. **Explanations** → *Quick setup* → pick a backend → paste its API key → **Save**.
   Start with **Gemini Flash-Lite**: it is free, fast, and good at Chinese.
   The link under the picker opens the right page to get a key.
2. **Read aloud** → leave it on *Natural voice (Azure)* and paste an Azure Speech key
   and region, or switch to *Windows voice* to use the free offline one.
   Click **🔊 Test voice** — it reports which engine actually produced the sound.

Nothing works until step 1 is done: `Ctrl+Alt+E` will tell you no key is set.

### Using it

Select text in **any** app, press **`Ctrl+Alt+E`**.

- Three words or fewer → treated as a term: IPA, part of speech, what it means *here*
- Longer → treated as a passage: natural Chinese, simpler English, idioms worth knowing
- **🔊** reads it aloud, **🐢** reads it slowly, **Esc** or `Ctrl+Alt+E` again closes it

| Hotkey | Action |
|---|---|
| `Ctrl+Alt+E` | Explain the selection (press again to dismiss) |
| `Esc` | Close the popup |

Change the shortcut in Settings by **pressing the keys you want** — it records the
chord rather than asking you to type accelerator syntax, and stores
`CommandOrControl+...` so one config is correct on Windows (Ctrl) and macOS (⌘).

**If a shortcut is already taken**, EasyTranslate binds the next free one and tells you
which, rather than leaving you with a key that silently does nothing. To see the whole
picture, quit the app first (it holds its own shortcuts) and run:

```bash
npm run probe:hotkeys
```

`Ctrl+Alt+Space` was the original default and is genuinely unavailable on any machine
with a Chinese or Japanese IME — `ChsIME` claims it.

### Providers

Swappable in Settings; each keeps its own model and base URL.

Settings has a **Quick setup** picker that sets provider, model and base URL together.
Groq and Gemini speak the OpenAI protocol, so the `openai` provider reaches them too —
only the base URL and model differ.

| Preset | Cost at ~100 lookups/day | Notes |
|---|---|---|
| Gemini Flash-Lite | free tier | Best Chinese of the free options |
| Groq | free tier | Fastest; Llama is the weakest here at Chinese |
| **Claude Haiku 4.5** | **~$3/month** | Reliable IPA, idiomatic Chinese — the value pick |
| Claude Sonnet 5 | ~$5/month | Sharper on slang and register |
| OpenAI nano | ~$0.20/month | Cheapest; least reliable on IPA |
| Ollama | free | Offline and private; ~11s per lookup on a CPU-only machine |

Note the base-URL conventions differ: the Anthropic SDK appends `/v1/messages` itself,
while the OpenAI SDK appends `/chat/completions` — so an OpenAI-style base URL must
already end in `/v1`.

API keys are encrypted at rest with Electron `safeStorage` (Windows DPAPI). If the OS
can't provide encryption, EasyTranslate **refuses to store the key** rather than writing
it in plaintext. `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars take precedence.

### Voices

Two choices, no more:

- **Natural voice (Azure)** — neural voices over plain HTTPS. Free for 500k characters
  a month, far more than reading uses. Needs a Speech resource key and its region.
- **Windows voice** — free, offline, instant, noticeably robotic. Always available as
  the automatic fallback when the online voice fails.

Azure's REST API is used rather than the Edge Read Aloud endpoint those same voices also
serve: Edge needs a WebSocket upgrade, which many corporate networks block outright.

The read-aloud key is stored separately from the explanation key, because the `openai`
LLM slot often holds a Gemini or Groq key that a speech API would reject.

---

## Verification

```bash
npm test               # unit tests — word counting, streaming parser, SSML, CSP
npm run verify:capture # end-to-end capture self-test
npm run verify:hotkeys # registration, refusal and fallback assertions
npm run probe:hotkeys  # which shortcuts are free on this machine
```

`verify:capture` opens a window with selectable text and asserts the two properties the
design rests on: that we read the selection, and that the clipboard comes back byte-for-
byte. **Click the test window when it appears** — Windows won't let a terminal-launched
app focus itself, and the run reports "inconclusive" (exit 2) rather than failing if it
never gets focus.

```
  PASS  Win32 bindings loaded
  PASS  test window is foreground
  PASS  capture returned text — 29ms
  PASS  captured text matches — "He is just grandstanding for the base."
  PASS  completed within budget — 29ms of 700ms
  PASS  clipboard restored exactly
```

`verify:hotkeys` asserts that clipboard shortcuts are refused, a free shortcut binds,
a conflict falls back instead of failing, and the availability check Settings relies on
tells the truth. Quit the app first — it holds its own shortcuts.

### Manual capture matrix

For each: select text → hotkey → confirm (a) the right text was captured, (b) Ctrl+V
still pastes your *original* clipboard, (c) the selection is still highlighted.

Edge (an X feed) · Chrome · ChatGPT desktop app · Microsoft Teams · Edge PDF viewer ·
VS Code · Notepad

---

## Security

The explanation text originates from whatever page you were reading, so it is treated
as untrusted throughout.

- **Renderers are sandboxed**, with `contextIsolation: true` and `nodeIntegration: false`.
  The only bridge is a small typed surface in `src/preload`. (The preload is built as
  CommonJS specifically so the sandbox can be enabled — a sandboxed renderer refuses an
  ESM preload outright, and the failure is silent.)
- **Model output is rendered as text, never HTML.** No `innerHTML`, no
  `dangerouslySetInnerHTML`, no `eval`.
- **Windows cannot navigate**, `<webview>` is refused, and `shell.openExternal` accepts
  only `http:` and `https:` — it would otherwise hand `file:` or `ms-msdt:` URLs to the
  OS. A Content-Security-Policy on each page restricts sources to self plus `data:`
  audio and images.
- **Selected text never reaches a shell or a parser unescaped.** The Windows voice
  receives it through a file, not a command line; Azure receives it XML-escaped, so a
  page cannot inject SSML. Both are covered by tests.
- **API keys are encrypted at rest** with Windows DPAPI via Electron `safeStorage`, in
  `%APPDATA%\easytranslate\secrets.json`. If the OS cannot encrypt, the app refuses to
  store the key rather than writing plaintext. `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
  environment variables take precedence. Read-aloud keeps a separate key slot, because
  the `openai` LLM slot often holds a Gemini or Groq key that a speech API would reject.
- **Nothing is sent anywhere except the provider you configure.** No telemetry, no
  analytics. Your selection goes to your chosen model and nowhere else.
- `npm audit --omit=dev` reports **0 vulnerabilities**. Remaining advisories are in
  build tooling only.

Worth knowing: the text you select is fed to a language model, so a page could in
principle word its content to influence what the explanation says. Output is rendered
as inert text and can't execute, but treat an explanation as what a model made of a web
page — not as fact.

## Known limits

- **Clipboard restore covers every format the platform reports.** Electron's clipboard
  API is format-agnostic, so whatever is on the clipboard — including file drops and
  app-private formats like an Excel cell range — is read and written back as-is. An
  earlier version enumerated text/HTML/RTF/images and lost anything else.
- **Apps running as administrator ignore the hotkey.** Windows blocks synthetic input
  from a lower-integrity process (UIPI) and no unelevated app can work around it. This
  surfaces as *"Either nothing is selected, or that app is running as administrator."*
- **Hotkey conflicts are invisible without checking.** A key owned by another process
  simply does nothing when pressed. `probe:hotkeys` tests Windows' `RegisterHotKey`,
  which is what Electron uses — but an app that grabs keys with a low-level keyboard
  hook (many IMEs, some vendor utilities) won't show as a conflict there and can still
  swallow the key. A combination that probes free yet never fires is almost certainly
  one of those; pick another.
- **DRM'd text, video subtitles and text baked into images can't be captured** — there's
  nothing for Ctrl+C to copy. This is what the deferred OCR snip solves; the capture
  layer is built behind an interface it can slot into.
- **Edge neural TTS is blocked on some networks.** Verified on this machine: the voices
  list endpoint returns 200 over plain HTTPS, but the synthesis WebSocket returns **403**
  — with and without the `Sec-MS-GEC` token, which points at the network blocking the WS
  upgrade rather than an auth problem. It's an unofficial endpoint and may also simply
  break someday. This is exactly why the offline Windows voice shipped in v1 instead of
  being deferred: read-aloud degrades to a more robotic voice rather than disappearing.
  If you want natural voices and this keeps failing, official Azure Speech (500k
  chars/month free) or OpenAI TTS would drop in behind `TtsProvider`.

### If Electron fails to start

On some Windows machines Electron's installer downloads its 115MB zip correctly but
`extract-zip` stalls after the first entry, leaving no `electron.exe` — usually security
software inspecting large archive writes. Re-running `npm install` doesn't help, since
it sees the valid cached zip and repeats the same broken extraction.

`npm run fix:electron` re-extracts from that cache using the platform unzip. It also runs
automatically as a `postinstall` and is a no-op when Electron is healthy.

---

## Layout

```
src/
├─ main/         app lifecycle, Win32 bindings, capture, popup, hotkeys, tray
│  ├─ win32.ts   koffi: SendInput, clipboard sequence, WS_EX_NOACTIVATE
│  ├─ capture.ts snapshot → Ctrl+C → poll → read → restore
│  ├─ popup.ts   the non-activating window
│  └─ verify.ts  capture self-test (loaded only behind --verify-capture)
├─ core/         mode detection, prompts, streaming parser, tokenizer, cache, config
├─ providers/    llm/{claude,openai,ollama}  tts/{edge,system}
├─ renderer/     popup UI and settings UI
└─ shared/       types used across all three processes
```

The model answers in fixed `## SECTION` blocks rather than JSON — streaming JSON can't be
rendered half-arrived, whereas sections let the popup fill in top-down as tokens land.
`SectionParser` is tested against chunk sizes from 1 byte upward, because chunk
boundaries fall mid-word, mid-header, and between the two `#` of a header.

## Platform support

Windows only today. The capture layer is Win32: `SendInput` for the synthetic Ctrl+C,
`GetClipboardSequenceNumber` to detect it landing, and `WS_EX_NOACTIVATE` to keep the
popup from taking focus — all through `koffi`, which ships prebuilt binaries, so there
is no node-gyp step.

macOS would need its own `src/main/win32.ts` equivalent: `CGEventPost` for the
synthetic ⌘C, `NSPasteboard.changeCount` in place of the sequence number (the same
trick, different name), a non-activating `NSPanel` for the popup, and the Accessibility
permission macOS requires before any app may synthesise input. Shortcuts are already
stored in a portable form. Everything above that layer — providers, prompts, parser,
UI — is platform-neutral.

### Deferred

OCR screen-snip via `Windows.Media.Ocr` · UI Automation context grab · clipboard-watch
mode · vocabulary history with SQLite and Anki export · macOS support.
