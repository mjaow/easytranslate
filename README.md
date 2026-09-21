# EasyTranslate

Select text in **any** Windows app, press `Ctrl+Alt+E`, and get it explained in English
and Chinese, with American-accent read-aloud. Works in Edge, Chrome, the ChatGPT desktop
app, Teams, PDFs, VS Code, anywhere. On YouTube or X, double-click a video with
captions on and the caption is explained too.

**It will not break your copy and paste.** Nothing of EasyTranslate ever enters a page,
and the popup never takes focus. See [How it works](#how-it-works).

---

## Getting started

**Windows 10 or 11.** Open PowerShell and paste one line:

```powershell
irm https://raw.githubusercontent.com/mjaow/easytranslate/main/install.ps1 | iex
```

It installs Node.js if you don't have it, downloads and builds the app into
`%LOCALAPPDATA%\EasyTranslate`, adds **EasyTranslate** to the Start menu and desktop,
and starts it. The first run takes a few minutes; Settings opens by itself so you can
paste a key. Run the same line again any time to update.

The app lives in the **system tray**: a two-tone circle near the clock, under the `^`
if Windows has hidden it. There is no main window. Start it later from the Start menu,
or turn on **Start EasyTranslate when I log in** in Settings and forget about it.

**macOS** is not supported yet: the text capture, the double-click detection and the
caption OCR are all Windows APIs. See [Platform support](#platform-support).

<details>
<summary>From source, for development</summary>

```bash
git clone https://github.com/mjaow/easytranslate.git
cd easytranslate
npm install
npm start        # builds and launches
npm run dev      # hot reload
```

</details>

### Configure it

Right-click the tray icon → **Settings…**

1. **Explanations** → *Quick setup* → pick a backend → paste its API key → **Save**.
   **Gemini Flash-Lite** is a good first choice: free, fast, good at Chinese. The link
   under the picker opens the page where you get a key.
2. **Read aloud** → paste an Azure Speech key and region for the natural voice, or
   switch to *Windows voice* for the free offline one. **🔊 Test voice** reports which
   engine actually produced the sound.

Settings opens by itself the first time, since nothing works until step 1 is done.

---

## Using it

| Gesture | Result |
|---|---|
| Select text, press `Ctrl+Alt+E` | Explain the selection |
| Double-click a YouTube or X video while captions are on | Explain the caption on screen |
| Double-click a line in the YouTube transcript panel | Explain that line |
| `Esc`, or `Ctrl+Alt+E` again | Close the popup |

- **Three words or fewer** are treated as a term: IPA, part of speech, what it means
  *here*, an example.
- **Anything longer** is treated as a passage: natural Chinese, simpler English, and
  the hard words and idioms in it, each with IPA, Chinese and an example.
- **Code** gets an offer: when the model judges the selection to be source code, the
  popup shows **This looks like code — explain what it does**. One click gives what it
  does in Chinese and English, a step-by-step walk through it, and the concepts in it
  worth knowing. Any language, a shell command, a query or a JSON fragment all count;
  a sentence that merely mentions `C++` does not.
- **🔊** reads it aloud, **🐢** reads it slowly, **⏹** stops.

The double-click needs no shortcut. On YouTube the words come from the page itself, so
they are exact; X draws its captions into the picture, so there the lower part of the
video is read with local OCR (nothing is uploaded). Only a caption or a transcript line
produces a popup; everything else on the page stays a plain click. YouTube treats a
double-click on the video as its fullscreen toggle, so double-click the caption text
itself to avoid that. The double-click can be turned off in Settings.

### Changing the shortcut

In Settings, **press the keys you want**; the chord is recorded, not typed. If the
shortcut is already owned by another app, EasyTranslate binds the next free one and
tells you which. To see which combinations are free on your machine, quit the app
first (it holds its own shortcuts) and run:

```bash
npm run probe:hotkeys
```

`Ctrl+Alt+Space` is taken on any machine with a Chinese or Japanese IME.

---

## Providers

Swappable in Settings. **Quick setup** sets provider, model and base URL together;
**Test connection** makes a real request and, if the model is refused, lists the model
ids that key can actually call. Groq and Gemini speak the OpenAI protocol, so the
`openai` provider reaches them with a different base URL and model.

| Preset | Cost at ~100 lookups/day | Notes |
|---|---|---|
| **Qwen Flash** | **~$0.07/month** | Alibaba's own model: cheapest, most idiomatic Chinese |
| Gemini Flash-Lite | free tier | Best Chinese of the free options |
| Groq | free tier | Fastest; Llama is the weakest here at Chinese |
| **Claude Haiku 4.5** | **~$3/month** | Reliable IPA, idiomatic Chinese |
| Claude Sonnet 5 | ~$5/month | Sharper on slang and register |
| OpenAI nano | ~$0.20/month | Cheap; least reliable on IPA |
| Ollama | free | Offline and private; ~11s per lookup on a CPU-only machine |

Base-URL conventions differ: the Anthropic SDK appends `/v1/messages` itself, while the
OpenAI SDK appends `/chat/completions`, so an OpenAI-style base URL must already end in
`/v1`.

### Voices

- **Natural voice (Azure)**: neural voices over plain HTTPS. Free for 500k characters a
  month, far more than reading uses. Needs a Speech resource key and its region.
- **Windows voice**: free, offline, instant, noticeably robotic. The automatic fallback
  when the online voice fails.

The read-aloud key has its own slot, because the `openai` LLM slot often holds a Gemini
or Groq key that a speech API would reject.

---

## Security

Selected text comes from whatever page you were reading, so it is treated as untrusted
throughout.

- **Renderers are sandboxed**, with context isolation on and node integration off. The
  only bridge is a small typed surface in `src/preload`.
- **Model output is rendered as text, never HTML.** No `innerHTML`, no `eval`.
- **Windows cannot navigate**, `<webview>` is refused, external links must be `http:`
  or `https:`, and each page carries a Content-Security-Policy.
- **Selected text never reaches a shell or a parser unescaped.** The Windows voice gets
  it through a file, Azure gets it XML-escaped. Both are covered by tests.
- **API keys are encrypted at rest** with Windows DPAPI via Electron `safeStorage`. If
  the OS cannot encrypt, the app refuses to store the key rather than writing
  plaintext. `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` environment variables take
  precedence.
- **Nothing is sent anywhere except the provider you configure.** No telemetry.
- `npm audit --omit=dev` reports 0 vulnerabilities.

A page could word its content to influence what the model says about it. The output
cannot execute, but treat an explanation as what a model made of a web page, not as
fact.

---

## Known limits

- **Apps running as administrator ignore the hotkey.** Windows blocks synthetic input
  from a lower-integrity process, and no unelevated app can work around it.
- **A shortcut owned by another process does nothing when pressed.** `probe:hotkeys`
  catches conflicts registered the normal way; an app that grabs keys with a low-level
  hook (some IMEs and vendor utilities) can still swallow the key. If a combination
  probes free yet never fires, pick another.
- **DRM'd text and text baked into images can't be captured.** There is nothing for
  Ctrl+C to copy.
- **Double-click-to-explain covers YouTube and X.** A double-click is only examined
  when a window titled "YouTube" or "… / X" is in front. If a caption or line ever fails to register,
  `last-click.log` in the data folder (tray → *Open data folder*) records what the
  accessibility tree reported.
- **Windows only.** See [Platform support](#platform-support).

### If Electron fails to start

On some machines Electron's installer downloads its zip correctly but the extraction
stalls after the first entry, leaving no `electron.exe`; usually security software
inspecting large archive writes. `npm run fix:electron` re-extracts from the cached zip
with the platform unzip. It also runs as a `postinstall` step and is a no-op when
Electron is healthy.

---

## Verification

```bash
npm test               # unit tests: parser, prompts, SSML escaping, CSP, transcript rules
npm run verify:capture # end-to-end capture: reads the selection, restores the clipboard exactly
npm run verify:hotkeys # clipboard shortcuts refused, conflicts fall back, availability check is honest
npm run verify:click   # real OS double-clicks on a YouTube-shaped page come back as the right lines
npm run verify:code    # asks the configured model: snippets come back as code, prose as prose
npm run probe:hotkeys  # which shortcuts are free on this machine
```

`verify:capture` needs you to **click its test window** when it appears, because Windows
will not let a terminal-launched app focus itself. `verify:hotkeys` needs the app quit
first.

Manual matrix, for each app: select text → hotkey → the right text was captured, Ctrl+V
still pastes your original clipboard, the selection is still highlighted. Edge · Chrome
· ChatGPT desktop app · Teams · Edge PDF viewer · VS Code · Notepad.

---

## How it works

```
  select text anywhere             your normal selection; EasyTranslate is not involved
            ↓
  press Ctrl+Alt+E                 global hotkey
            ↓
  snapshot the clipboard           every format, as-is
  note GetClipboardSequenceNumber()
            ↓
  SendInput: a clean Ctrl+C        held modifiers released first, all in one batch
            ↓
  poll the sequence number         every 10ms, up to 700ms; one retry if nothing landed
            ↓
  read the copied text, restore your original clipboard
            ↓
  non-activating popup at the cursor, explanation streamed in
```

**Why not a browser extension.** To offer click-to-translate, an extension must inject
DOM next to your selection, and that overlay collapses the selection so your own Ctrl+C
grabs nothing. It also only lives in one browser. Running outside every app, driven by a
global hotkey, is what makes "works everywhere" and "never touches your selection"
both free.

**The copy-safety contract.** Testable rules the implementation holds to:

1. No content scripts, no injected DOM, no page listeners.
2. The clipboard is always restored, every format, typically within ~150ms.
3. The popup never takes focus. Electron's `focusable: false` is
   [unreliable on Windows](https://github.com/electron/electron/issues/11049), so the
   popup also has `WS_EX_NOACTIVATE` stamped onto its window handle and reads the style
   back to confirm it stuck.
4. Ctrl+C, Ctrl+V and Ctrl+X can never be bound, whatever the config says.

**Why the clipboard sequence number.** A fixed sleep is slower than needed on fast apps
and unreliable on slow ones, and cannot tell "this app is slow" from "this app ignored
Ctrl+C". Watching the counter Windows bumps on every clipboard write does both. Measured
round trip: 23ms.

**The YouTube double-click.** The mouse button is polled, nothing is hooked. A
double-click on a YouTube window is looked up in the page's accessibility tree: a
transcript line is a button named with its spoken time, and a caption is a
`caption-window` element inside the player. X draws captions natively, where no
accessibility tree can see them, so there the tree supplies the video's rectangle and
the lower part of it is read with `Windows.Media.Ocr`.

**Streaming.** The model answers in fixed `## SECTION` blocks rather than JSON, so the
popup fills in top-down as tokens land. The parser is tested against chunk sizes from
one byte upward.

**Code.** No pattern decides whether a selection is code. The ordinary answer opens
with a one-word verdict from the model (`## CODE`, yes or no); a yes makes the popup
offer to explain it, and the click is a second request with the dedicated code prompt
(`LANG`, `STEPS`, `CONCEPTS`). The selection reaches the model fenced, with its line
breaks and indentation kept. `verify:code` checks both steps against the configured
model with a mix of snippets and prose that mentions code.

---

## Layout

```
src/
├─ main/           app lifecycle, tray, hotkeys, capture, popup, click watcher
│  ├─ win32.ts     koffi bindings: SendInput, clipboard sequence, cursor, window styles
│  ├─ capture.ts   snapshot → Ctrl+C → poll → read → restore
│  ├─ clicks.ts    double-click detection by polling the mouse button
│  ├─ uia.ts       what the accessibility tree holds under a point (PowerShell script in resources/)
│  ├─ ocr.ts       read a screen region with Windows.Media.Ocr, for natively drawn captions
│  ├─ popup.ts     the non-activating window
│  └─ verify*.ts   self-tests, loaded only behind their CLI flags
├─ core/           mode detection, prompts, streaming parser, transcript rules, cache, config
├─ providers/      llm/{claude,openai,ollama}   tts/{azure,system}
├─ renderer/       popup UI and settings UI
└─ shared/         types used across all three processes
```

## Platform support

Windows only today. The capture layer is Win32 through `koffi`, which ships prebuilt
binaries, so there is no node-gyp step. The YouTube double-click uses UI Automation
through Windows PowerShell.

macOS would need equivalents of that layer: `CGEventPost` for the synthetic ⌘C,
`NSPasteboard.changeCount` in place of the sequence number, a non-activating `NSPanel`
for the popup, the Accessibility API for the double-click, and the Accessibility
permission macOS requires before any app may synthesise input. Shortcuts are already
stored in a portable form. Everything above that layer, providers, prompts, parser and
UI, is platform-neutral.
