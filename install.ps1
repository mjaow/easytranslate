# EasyTranslate — install or update with one command, then start it.
#
#   irm https://raw.githubusercontent.com/mjaow/easytranslate/main/install.ps1 | iex
#
# What it does, in order:
#   1. Makes sure Node.js 20+ is present (installs it with winget if not).
#   2. Downloads the app source to %LOCALAPPDATA%\EasyTranslate\app.
#   3. Builds it there.
#   4. Adds Start menu and desktop shortcuts, with Ctrl+Alt+T to launch.
#   5. Starts it.
#
# Running the same command again updates the app. Your settings and keys live in
# %APPDATA%\easytranslate and are untouched by an update.
#
# Nothing here needs administrator rights, except that winget may ask for them once
# to install Node.js.

param(
  # Which branch or tag to install. The default is what everyone should run.
  [string]$Ref = 'main',
  # Where to install. The default is per-user and needs no administrator rights.
  [string]$Dir = (Join-Path $env:LOCALAPPDATA 'EasyTranslate')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repo = 'mjaow/easytranslate'
$root = $Dir
$app = Join-Path $root 'app'

function Step([string]$text) { Write-Host "`n==> $text" -ForegroundColor Cyan }

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Node-Major {
  try {
    $v = (& node -v 2>$null)
    if ($v -match '^v(\d+)') { return [int]$Matches[1] }
  } catch { }
  return 0
}

# --- 1. Node.js ---------------------------------------------------------------
Step 'Checking for Node.js 20 or newer'
if ((Node-Major) -lt 20) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host 'Installing Node.js LTS with winget (this may ask for permission)...'
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements | Out-Null
    Refresh-Path
  }
  if ((Node-Major) -lt 20) {
    throw 'Node.js 20 or newer is needed. Install it from https://nodejs.org and run this command again.'
  }
}
Write-Host "Node.js $(& node -v)"

# --- 2. Download ------------------------------------------------------------------
Step "Downloading EasyTranslate ($Ref)"
New-Item -ItemType Directory -Force -Path $root | Out-Null
$zip = Join-Path $root 'easytranslate.zip'
$stage = Join-Path $root 'stage'
Invoke-WebRequest -Uri "https://github.com/$repo/archive/refs/heads/$Ref.zip" -OutFile $zip
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
Expand-Archive -Path $zip -DestinationPath $stage -Force
$extracted = Get-ChildItem $stage -Directory | Select-Object -First 1

# A running copy holds its files open, so an update has to stop it first. It is
# started again at the end.
$running = Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like "*$app*" }
if ($running) {
  Write-Host 'Stopping the running EasyTranslate for the update...'
  $running | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

# Replace the app in place, keeping node_modules so an update is a rebuild rather
# than another download of Electron.
New-Item -ItemType Directory -Force -Path $app | Out-Null
Get-ChildItem $app -Force | Where-Object { $_.Name -ne 'node_modules' } | Remove-Item -Recurse -Force
Get-ChildItem $extracted.FullName -Force | Move-Item -Destination $app -Force
Remove-Item -Recurse -Force $stage
Remove-Item -Force $zip

# --- 3. Build -------------------------------------------------------------------------
Step 'Installing dependencies (first time takes a few minutes; Electron is ~120 MB)'
Push-Location $app
try {
  & npm install --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

  Step 'Building'
  # Quiet on success; on failure, the whole build log is what you need to see.
  $log = & npx electron-vite build 2>&1
  if ($LASTEXITCODE -ne 0) {
    $log | ForEach-Object { Write-Host $_ }
    throw 'build failed'
  }
  $log | Select-Object -Last 1 | ForEach-Object { Write-Host $_ }
} finally {
  Pop-Location
}

$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { throw "Electron did not install correctly ($electron is missing). Run the command again." }

# --- 4. Shortcuts ------------------------------------------------------------------
Step 'Adding EasyTranslate to the Start menu and desktop'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $app 'scripts\create-windows-shortcuts.ps1') -AppPath $app
if ($LASTEXITCODE -ne 0) { throw 'Creating launch shortcuts failed' }

# --- 5. Start ------------------------------------------------------------------------
Step 'Starting EasyTranslate'
Start-Process -FilePath $electron -ArgumentList ('"' + $app + '"') -WorkingDirectory $app -WindowStyle Hidden

Write-Host ''
Write-Host 'EasyTranslate is running in the system tray (the two-tone circle near the clock).' -ForegroundColor Green
Write-Host 'Settings opens on first run: paste a model API key there, then select any text and press Ctrl+Alt+E.'
Write-Host 'To start it later: Ctrl+Alt+T, Start menu -> EasyTranslate, or turn on "Start when I log in" in Settings.'
Write-Host 'To update: run this same command again.'
