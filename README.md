# EasyTranslate

Select text in **any** app, press `Ctrl+Alt+E` (`⌘⌥E` on a Mac), and get it explained
in English and Chinese, with American-accent read-aloud. Works in Edge, Chrome, Safari,
the ChatGPT desktop app, Teams, PDFs, VS Code, anywhere. On YouTube or X, double-click a
video with captions on and the caption is explained too.

**Windows 10/11 and macOS 13+.**

**It will not break your copy and paste.** Nothing of EasyTranslate ever enters a page,
and the popup never takes focus. See [How it works](#how-it-works).

---

## Getting started

### Windows

Open PowerShell and paste one line:

```powershell
irm https://raw.githubusercontent.com/mjaow/easytranslate/main/install.ps1 | iex
```

It installs Node.js if you don't have it, downloads and builds the app into
`%LOCALAPPDATA%\EasyTranslate`, adds **EasyTranslate** to the Start menu and desktop,
and starts it. The first run takes a few minutes; Settings opens by itself so you can
paste a key. Run the same line again any time to update.

Press **`Ctrl+Alt+T`** to start EasyTranslate later, without opening a terminal. If it
is already running, this opens Settings. Keep the desktop shortcut: Windows uses it
for this launch key. **`Ctrl+Alt+E`** explains selected text once the app is running.
To change the launch key, right-click the desktop shortcut → **Properties → Shortcut
key → Apply**. Running the installer or shortcut setup again restores `Ctrl+Alt+T`.

The app lives in the **system tray**: a two-tone circle near the clock, under the `^`
if Windows has hidden it. There is no main window.

### macOS

Open Terminal and paste one line:

```bash
curl -fsSL https://raw.githubusercontent.com/mjaow/easytranslate/main/install.sh | bash
```

Same idea: Node.js if it is missing, the app built into `~/.easytranslate`,
**EasyTranslate** in `~/Applications` so Spotlight finds it, and it starts.

Then do the one thing no installer can do for you:

> **System Settings → Privacy & Security → Accessibility → switch on Electron**, then
> quit EasyTranslate and start it again.

macOS will not let *any* app read your selection until you allow it, and it only checks
at launch — so the restart matters. EasyTranslate says so on first run and offers to
open the right page. (The switch is labelled **Electron**, not EasyTranslate, because
an installed-from-source build runs on Electron's own binary.)

The app lives in the **menu bar**, near the clock. There is no dock icon and no main
window.

On either platform, start it later from the Start menu or Spotlight, or turn on
**Start EasyTranslate when I log in** in Settings and forget about it.

<details>
<summary>From source, for development</summary>

```bash
git clone https://github.com/mjaow/easytranslate.git
cd easytranslate
npm install
npm start        # builds and launches
npm run dev      # hot reload
```

On Windows, run this once to build the app and add Start menu and desktop shortcuts
for this checkout:

```bash
npm run setup:shortcuts
```

Then press `Ctrl+Alt+T` to launch it. The shortcuts use the existing build, so after
changing source code run `npm run build` and restart the app. If you move the checkout,
run `npm run setup:shortcuts` again to update the shortcut paths.

For a source build on macOS, grant Accessibility to the Electron binary
under `node_modules/electron/dist` — dragging it into the Accessibility list from Finder
is the quickest way — or every capture will silently read nothing.

</details>

### Configure it

Right-click the tray icon → **Settings…**

1. **Explanations** → *Quick setup* → pick a backend → paste its API key → **Save**.
   **Gemini Flash-Lite** is a good first choice: free, fast, good at Chinese. The link
   under the picker opens the page where you get a key.
2. **Read aloud** → paste an Azure Speech key and region for the natural voice, or
   switch to the free offline system voice — SAPI on Windows, `say` on macOS.
   **🔊 Test voice** reports which engine actually produced the sound.

Settings opens by itself the first time, since nothing works until step 1 is done.

---

## Using it

| Gesture | Result |
|---|---|
| Select text, press `Ctrl+Alt+E` (`⌘⌥E`) | Explain the selection |
| Double-click a YouTube or X video while captions are on | Explain the caption on screen |
| Double-click a line in the YouTube transcript panel | Explain that line |
| `Esc`, or the shortcut again | Close the popup |

- **Three words or fewer** are treated as a term: IPA, part of speech, what it means
  *here*, an example.
- **Anything longer** is treated as a passage: natural Chinese, simpler English, and
  the hard words and idioms in it, each with IPA, Chinese and an example.
- **Code** gets an offer: when the model judges the selection to be source code, the
  popup shows **This looks like code — explain what it does**. One click gives a code
  review rather than a paraphrase: what it does, what problem it solves and why this
  approach, a step-by-step walk through it, why it is written the way it is, any bugs
  or edge cases visible in the snippet, and the concepts worth knowing. Any language,
  a shell command, a query or a JSON fragment all count; a sentence that merely
  mentions `C++` does not. Settings can point code explanations at a stronger model
  than everyday lookups use, since design and bug reasoning is where that pays off.
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

`Ctrl+Alt+Space` is taken on any machine with a Chinese or Japanese IME. On macOS the
probe offers Command combinations rather than Control ones, because Control+Option is
where macOS keeps its own shortcuts and a bare `⌥`+letter is the dead key for typing an
accented character.

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
- **System voice**: free, offline, instant, noticeably robotic — SAPI on Windows,
  `say` on macOS. The automatic fallback when the online voice fails. On a Mac set up
  in another language it uses Samantha rather than the system default, since hearing
  American English is the point.

The read-aloud key has its own slot, because the `openai` LLM slot often holds a Gemini
or Groq key that a speech API would reject.

---

## Security

Selected text comes from whatever page you were reading, so it is treated as untrusted
throughout.

- **Renderers are sandboxed**, with context isolation on and node integration off. The
  only bridge is a small typed surface in `src/preload`.
- **Model output is rendered as text, never HTML.** No `innerHTML`, no `eval`.
- **The app's own windows cannot navigate**, `<webview>` is refused, external links must be `http:`
  or `https:`, and each page carries a Content-Security-Policy.
- **Selected text never reaches a shell or a parser unescaped.** The offline voice gets
  it through a file on both platforms — PowerShell reads the file, `say -f` reads the
  file — and Azure gets it XML-escaped. Covered by tests.
- **API keys are encrypted at rest** through Electron `safeStorage`: Windows DPAPI, and
  the login Keychain on macOS. Either way the ciphertext is bound to the user account
  and useless if the file is copied elsewhere. If the OS cannot encrypt, the app
  refuses to store the key rather than writing plaintext. `ANTHROPIC_API_KEY` and
  `OPENAI_API_KEY` environment variables take precedence.
- **Nothing is read off the screen except when you ask.** The OCR path runs only on a
  double-click inside a video that has no caption in its accessibility tree, reads one
  band of pixels, and recognises it with the OS's own engine — `Windows.Media.Ocr` or
  Apple's Vision. No image leaves the machine.
- **Nothing is sent anywhere except the provider you configure.** No telemetry.
- `npm audit --omit=dev` reports 0 vulnerabilities.

A page could word its content to influence what the model says about it. The output
cannot execute, but treat an explanation as what a model made of a web page, not as
fact.

---

## Known limits

**Both platforms**

- **A shortcut owned by another process does nothing when pressed.** `probe:hotkeys`
  catches conflicts registered the normal way; an app that grabs keys first with a
  low-level hook or a `CGEventTap` (some IMEs and vendor utilities) can still swallow
  the key. If a combination probes free yet never fires, pick another.
- **DRM'd text and text baked into images can't be captured.** There is nothing for
  the copy to copy.
- **Double-click-to-explain covers YouTube and X.** A double-click is only examined
  when a window titled "YouTube" or "… / X" is in front. If a caption or line ever
  fails to register, `last-click.log` in the data folder (tray → *Open data folder*)
  records what the accessibility tree reported.

**Windows**

- **Apps running as administrator ignore the hotkey.** Windows blocks synthetic input
  from a lower-integrity process, and no unelevated app can work around it.

**macOS**

- **Nothing works until Accessibility is granted**, and macOS reads that grant only
  when the app launches — so switching it on while EasyTranslate is running does
  nothing until you quit and start it again. The app checks at startup and says so
  rather than letting every press fail in silence.
- **The switch is labelled "Electron"** for an installed-from-source build, because
  that is the binary the OS sees. A packaged `.app` from `npm run dist:mac` appears
  under its own name.
- **Secure input fields block the copy.** While a password field has focus — or any
  app has turned on secure event input — macOS refuses synthetic keystrokes from
  everyone. This is the macOS counterpart of the elevated-window rule above.
- **Reading captions off the picture needs Screen Recording** as well, since that path
  takes a picture of one band of the screen. Only X needs it; YouTube's captions come
  from the page. The popup says which permission is missing.

### If Electron fails to start

On some Windows machines Electron's installer downloads its zip correctly but the
extraction stalls after the first entry, leaving no `electron.exe`; usually security
software inspecting large archive writes. `npm run fix:electron` re-extracts from the
cached zip with the platform unzip. It also runs as a `postinstall` step, and is a
no-op when Electron is healthy and on macOS, which has never shown the problem.

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

Every one of these runs on both platforms and exercises that platform's own layer —
`verify:capture` posts a real `Ctrl+C` or `⌘C`, `verify:click` sends real OS mouse
clicks and reads the real accessibility tree, `verify:code` asks the configured model.

`verify:capture` may need you to **click its test window** when it appears: Windows
will not let a terminal-launched app focus itself at all, and macOS occasionally loses
the race with whatever was already frontmost. `verify:hotkeys` needs the app quit first.

Manual matrix, for each app: select text → hotkey → the right text was captured, your
own paste still gives your original clipboard, the selection is still highlighted.
Windows: Edge · Chrome · ChatGPT desktop app · Teams · Edge PDF viewer · VS Code ·
Notepad. macOS: Safari · Chrome · Preview · Notes · VS Code · Terminal.

---

## How it works

```
  select text anywhere             your normal selection; EasyTranslate is not involved
            ↓
  press the hotkey                 global, Ctrl+Alt+E or ⌘⌥E
            ↓
  snapshot the clipboard           every format, as-is
  note the OS change counter
            ↓
  synthesise a clean copy          held modifiers released first
            ↓
  poll the change counter          every 10ms, up to 700ms; one retry if nothing landed
            ↓
  read the copied text, restore your original clipboard
            ↓
  non-activating popup at the cursor, explanation streamed in
```

Two operating systems, the same seven steps. Only the middle three are native, and
each platform does them its own way:

| | Windows | macOS |
|---|---|---|
| change counter | `GetClipboardSequenceNumber` | `NSPasteboard.changeCount` |
| synthetic copy | `SendInput` → Ctrl+C | `CGEventPost` → ⌘C |
| never take focus | `WS_EX_NOACTIVATE` on the HWND | `canBecomeKeyWindow == NO`, app hidden from the dock |
| pointer + button | `GetCursorPos`, `GetAsyncKeyState` | `CGEventGetLocation`, `CGEventSourceButtonState` |
| window in front | `GetWindowTextW` | `AXFocusedWindow` → `AXTitle` |
| tree under a point | UI Automation, via PowerShell | Accessibility API, in process |
| reading the screen | `Windows.Media.Ocr` | Vision, via JavaScript for Automation |
| offline voice | SAPI (`System.Speech`) | `say` |
| key storage | DPAPI | login Keychain |

Everything above that table — providers, prompts, the streaming parser, the popup and
settings UIs, the transcript and caption rules — is one implementation, shared.

**Why not a browser extension.** To offer click-to-translate, an extension must inject
DOM next to your selection, and that overlay collapses the selection so your own Ctrl+C
grabs nothing. It also only lives in one browser. Running outside every app, driven by a
global hotkey, is what makes "works everywhere" and "never touches your selection"
both free.

**The copy-safety contract.** Testable rules the implementation holds to:

1. No content scripts, no injected DOM, no page listeners.
2. The clipboard is always restored, every format, typically within ~150ms.
3. The popup never takes focus, and that is checked rather than assumed. Electron's
   `focusable: false` is
   [unreliable on Windows](https://github.com/electron/electron/issues/11049), so there
   the popup also has `WS_EX_NOACTIVATE` stamped onto its window handle, and the style
   is read back. On macOS `focusable: false` *is* the mechanism — it makes the window
   refuse to become key — so what is read back is `canBecomeKeyWindow`, on the real
   `NSWindow`, at the moment the popup is first ready. (`type: 'panel'` and the
   non-activating panel style would be the tidier answer, but as of Electron 44 the
   window it builds is a plain `NSWindow`, AppKit refuses the style, and the window
   then never becomes ready to show at all.) The other half of the macOS guarantee is
   not a window flag: hiding the app from the dock makes it an accessory application,
   and an accessory application does not come forward when one of its windows appears.
4. The platform's copy, paste and cut chords can never be bound, whatever the config
   says — Ctrl+C/V/X and ⌘C/V/X alike, since a config recorded on one platform can be
   read on the other.

**Why the clipboard change counter.** A fixed sleep is slower than needed on fast apps
and unreliable on slow ones, and cannot tell "this app is slow" from "this app ignored
the copy". Watching the counter the OS bumps on every clipboard write does both, and
both platforms keep one. Measured round trip: 23ms on Windows; on macOS about 100ms
for the first lookup after launch and ~30ms once warm, the difference being the first
touch of the Objective-C runtime.

`verify:capture` checks this twice — once normally, and once with the hotkey's own
modifiers physically held down, which is the case the release-then-copy dance exists
for and the one a plain call would never exercise.

**The YouTube double-click.** The mouse button is polled, nothing is hooked. A
double-click on a YouTube window is looked up in the page's accessibility tree: a
transcript line is a button named with its spoken time, and a caption is a
`caption-window` element inside the player. X draws captions natively, where no
accessibility tree can see them, so there the tree supplies the video's rectangle and
the lower part of it is read with the OS's own text recogniser.

The two trees do not look alike, and that is the one place the platforms genuinely
differ rather than merely spell things differently. UI Automation hands back Chromium's
HTML `class` attribute as the element's class name, so `caption-window` matches
directly. The macOS tree has no class name: an element arrives as a role (`AXButton`,
`AXStaticText`, `AXGroup`) with a title, a description and a DOM id, so the same
caption is recognised from `AXDOMIdentifier` and `AXDOMClassList` instead. Both walks
end in the same `PointRead`, and one set of rules
(`src/core/transcript.ts`) decides from it whether that was a transcript line — which
is what keeps the feature's behaviour identical rather than merely similar. macOS also
gets the answer far quicker: the Accessibility API is plain C, so the read happens in
process in about 4ms, where Windows pays a PowerShell start-up of roughly a second.

Polling differs for one honest reason. `GetAsyncKeyState` records a press that fell
entirely between two polls, so Windows can poll every 15ms and still never miss a
click. `CGEventSourceButtonState` has no such bit, so macOS polls every 8ms instead —
a human press-and-release is 30ms at its very fastest, and 8ms of a microsecond call
is still invisible.

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
│  ├─ native/      the platform layer — the only OS-specific code in the app
│  │  ├─ types.ts    what a backend must do, and what each call means
│  │  ├─ index.ts    picks one at startup; a platform with no backend gets no-ops
│  │  ├─ win32.ts    koffi bindings: SendInput, clipboard sequence, cursor, window styles
│  │  ├─ macos.ts    koffi bindings: CGEventPost, NSPasteboard.changeCount, cursor, focus
│  │  ├─ objc.ts     just enough Objective-C runtime to reach what has no C surface
│  │  └─ ax.ts       the macOS Accessibility API
│  ├─ capture.ts   snapshot → copy → poll → read → restore
│  ├─ clicks.ts    double-click detection by polling the mouse button
│  ├─ coords.ts    physical screen pixels ↔ Electron's device-independent ones
│  ├─ a11y.ts      what the accessibility tree holds under a point, either platform
│  ├─ a11y-macos.ts  the macOS walk (Windows uses a PowerShell script in resources/)
│  ├─ ocr.ts       read a screen region, for natively drawn captions
│  ├─ popup.ts     the non-activating window
│  └─ verify*.ts   self-tests, loaded only behind their CLI flags
├─ core/           mode detection, prompts, streaming parser, transcript and tree rules, cache, config
├─ providers/      llm/{claude,openai,ollama}   tts/{azure,system}
├─ renderer/       popup UI and settings UI
└─ shared/         types used across all three processes

resources/
├─ transcript-at-point.ps1   the Windows accessibility read
├─ snip-ocr.ps1              Windows.Media.Ocr
└─ snip-ocr.js               Apple Vision, through JavaScript for Automation
```

## Platform support

Windows 10/11 and macOS 13+, from the same source tree.

`src/main/native/` is where the difference lives. Outside it, the code that still has
to know is small and named: `coords.ts` (one unit conversion Windows needs and macOS
does not), `a11y-macos.ts` and `ocr.ts` (each dispatches to the OS's own reader), the
offline half of `providers/tts/system.ts`, the hotkey candidate lists, and the handful
of sentences in Settings that name a key or a System Settings pane. Everything else —
the capture algorithm, the click watcher, the transcript and caption rules, providers,
prompts, the streaming parser, both UIs — is one implementation. Adding a third
platform means writing one more backend against `native/types.ts`, not another fork of
the app.

Neither backend needs a compiler. Both go through [koffi](https://koffi.dev), which
ships prebuilt binaries, so there is no node-gyp step, no Visual Studio Build Tools and
no Xcode. Shortcuts are stored in a portable form (`CommandOrControl+Alt+E`), so a
config written on one platform is already correct on the other.

The honest asymmetries:

- **macOS asks permission; Windows does not.** Synthetic input needs Accessibility, and
  reading pixels needs Screen Recording. Both are one-time switches, both are checked
  and reported rather than failing in silence, and the Accessibility grant is read only
  at launch — so it takes a restart.
- **Windows shells out where macOS does not.** The accessibility read and the OCR are
  PowerShell scripts on Windows because UI Automation and `Windows.Media.Ocr` are .NET
  and WinRT; on macOS both are C or scriptable, so the read runs in process and only
  the screen capture and Vision call leave it.
- **`type: 'panel'` is not usable.** The natural macOS home for a non-activating popup
  is an `NSPanel`, and Electron 44 does not actually produce one. What the popup relies
  on instead is described under [How it works](#how-it-works), and it is verified at
  runtime rather than assumed.
