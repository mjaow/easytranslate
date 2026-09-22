#!/bin/bash
# EasyTranslate — install or update with one command on macOS, then start it.
#
#   curl -fsSL https://raw.githubusercontent.com/mjaow/easytranslate/main/install.sh | bash
#
# What it does, in order:
#   1. Makes sure Node.js 20+ is present (installs it with Homebrew if not).
#   2. Downloads the app source to ~/.easytranslate/app.
#   3. Builds it there.
#   4. Puts EasyTranslate in ~/Applications, so Spotlight and Finder can find it.
#   5. Starts it.
#
# Running the same command again updates the app. Your settings live in
# ~/Library/Application Support/easytranslate and your API keys in the Keychain;
# an update touches neither.
#
# Nothing here needs administrator rights.
#
# One thing this script cannot do for you: macOS will not let any app read your
# selection until you allow it under Privacy & Security → Accessibility. The app
# says so on first run and offers to open the right page.

set -euo pipefail

REPO='mjaow/easytranslate'
REF="${EASYTRANSLATE_REF:-main}"
# Not "Application Support/EasyTranslate": the app's own data folder there is
# "easytranslate", and the default macOS filesystem would treat the two as one.
ROOT="${EASYTRANSLATE_DIR:-$HOME/.easytranslate}"
APP="$ROOT/app"
LAUNCHER="$HOME/Applications/EasyTranslate.app"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

# The major version of the node on PATH, or 0 when there is none.
node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -v 2>/dev/null | sed -n 's/^v\([0-9]*\).*/\1/p' | head -1
}

# --- 1. Node.js ---------------------------------------------------------------
step 'Checking for Node.js 20 or newer'
if [ "$(node_major)" -lt 20 ]; then
  if command -v brew >/dev/null 2>&1; then
    echo 'Installing Node.js with Homebrew...'
    brew install node
  fi
  if [ "$(node_major)" -lt 20 ]; then
    die 'Node.js 20 or newer is needed. Install it from https://nodejs.org and run this command again.'
  fi
fi
echo "Node.js $(node -v)"

# --- 2. Download --------------------------------------------------------------
step "Downloading EasyTranslate ($REF)"
mkdir -p "$ROOT"
STAGE="$ROOT/stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
curl -fsSL "https://github.com/$REPO/archive/refs/heads/$REF.tar.gz" | tar -xz -C "$STAGE"
EXTRACTED="$(find "$STAGE" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -n "$EXTRACTED" ] || die 'The download did not contain the app.'

# A running copy holds its own hotkeys, so an update has to stop it first. It is
# started again at the end.
if pgrep -f "Electron.*$APP" >/dev/null 2>&1; then
  echo 'Stopping the running EasyTranslate for the update...'
  pkill -f "Electron.*$APP" || true
  sleep 2
fi

# Replace the app in place, keeping node_modules so an update is a rebuild rather
# than another download of Electron.
mkdir -p "$APP"
find "$APP" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
# shellcheck disable=SC2044
for entry in "$EXTRACTED"/* "$EXTRACTED"/.[!.]*; do
  [ -e "$entry" ] || continue
  mv -f "$entry" "$APP/"
done
rm -rf "$STAGE"

# --- 3. Build -----------------------------------------------------------------
step 'Installing dependencies (first time takes a few minutes; Electron is ~120 MB)'
cd "$APP"
npm install --no-audit --no-fund --loglevel=error

step 'Building'
npx electron-vite build

ELECTRON="$APP/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
[ -x "$ELECTRON" ] || die "Electron did not install correctly ($ELECTRON is missing). Run the command again."

# --- 4. Launcher --------------------------------------------------------------
#
# A minimal application bundle, so EasyTranslate is in Spotlight and Finder like
# anything else. It is a wrapper: the process that actually runs is Electron, which
# is also the name that appears in the Accessibility list.
step 'Adding EasyTranslate to ~/Applications'
mkdir -p "$LAUNCHER/Contents/MacOS"
cat > "$LAUNCHER/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>EasyTranslate</string>
  <key>CFBundleDisplayName</key><string>EasyTranslate</string>
  <key>CFBundleIdentifier</key><string>com.mjaow.easytranslate.launcher</string>
  <key>CFBundleExecutable</key><string>EasyTranslate</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <!-- A menu bar app: no dock icon, no menu bar of its own. -->
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

cat > "$LAUNCHER/Contents/MacOS/EasyTranslate" <<LAUNCH
#!/bin/bash
exec "$ELECTRON" "$APP"
LAUNCH
chmod +x "$LAUNCHER/Contents/MacOS/EasyTranslate"
# Finder caches bundles by path; touching it makes the new one take effect at once.
touch "$LAUNCHER"

# --- 5. Start -----------------------------------------------------------------
step 'Starting EasyTranslate'
"$ELECTRON" "$APP" >/dev/null 2>&1 &
disown || true

cat <<'DONE'

EasyTranslate is running in the menu bar (the two-tone circle near the clock).

Two things to do now:
  1. macOS blocks apps from reading your selection until you allow them. Open
     System Settings → Privacy & Security → Accessibility and switch on Electron,
     then quit EasyTranslate and start it again — macOS only checks at launch.
  2. Settings opens by itself: paste a model API key there.

Then select any text anywhere and press ⌘⌥E.

To start it later: Spotlight → EasyTranslate, or turn on "Start when I log in".
To update: run this same command again.
DONE
