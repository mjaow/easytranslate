# Create launch shortcuts for a built source checkout or an installed copy.
param(
  [string]$AppPath = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') { throw 'Launch shortcut setup is only supported on Windows.' }

$app = (Resolve-Path -LiteralPath $AppPath).ProviderPath
$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electron -PathType Leaf)) {
  throw 'Electron is missing. Run npm install before setting up shortcuts.'
}
if (-not (Test-Path -LiteralPath (Join-Path $app 'out\main\index.js') -PathType Leaf)) {
  throw 'The app has not been built. Run npm run build before setting up shortcuts.'
}

# Ask Windows for the actual folders, including a Desktop redirected to OneDrive.
$programs = [Environment]::GetFolderPath('Programs')
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
foreach ($folder in @($programs, $desktop)) {
  if (-not $folder -or -not (Test-Path -LiteralPath $folder -PathType Container)) {
    throw 'Windows did not return existing Start menu and Desktop folders.'
  }
}

if (-not ('EasyTranslate.ShortcutShell' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace EasyTranslate {
  public static class ShortcutShell {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern void SHChangeNotify(uint eventId, uint flags, string item1, IntPtr item2);
  }
}
'@
}

$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @($programs, $desktop)) {
  $shortcutPath = Join-Path $folder 'EasyUnderstand.lnk'
  $existed = Test-Path -LiteralPath $shortcutPath
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $electron
  $shortcut.Arguments = '"' + $app + '"'
  $shortcut.WorkingDirectory = $app
  $shortcut.IconLocation = $electron + ',0'
  $shortcut.WindowStyle = 1
  $shortcut.Description = 'Understand words, code, and videos with explanations and transcript analysis'

  # Only the Desktop shortcut owns the launch key. Clear a previous Start menu
  # binding so the two shortcuts never compete for the same key combination.
  $shortcut.Hotkey = ''
  if ($folder -eq $desktop) { $shortcut.Hotkey = 'CTRL+ALT+T' }
  $shortcut.Save()

  # Keep an existing EasyTranslate link usable, but give the launch hotkey only
  # to the new desktop link. Never alter a link belonging to another checkout.
  $legacyPath = Join-Path $folder 'EasyTranslate.lnk'
  if (Test-Path -LiteralPath $legacyPath -PathType Leaf) {
    $legacy = $shell.CreateShortcut($legacyPath)
    if ($legacy.TargetPath -eq $electron -and $legacy.Arguments -eq $shortcut.Arguments) {
      $legacy.Hotkey = ''
      $legacy.Description = $shortcut.Description
      $legacy.Save()
      [EasyTranslate.ShortcutShell]::SHChangeNotify(0x00020000, 0x1005, $legacyPath, [IntPtr]::Zero)
    }
  }

  # Saving a .lnk with a Hotkey does not always register it with Explorer.
  # Notify the shell after saving directly in its final location. SHCNF_PATHW
  # supplies a Unicode path; SHCNF_FLUSH waits for the notification to be handled.
  $eventId = if ($existed) { 0x00020000 } else { 0x00000002 } # UPDATEITEM / CREATE
  [EasyTranslate.ShortcutShell]::SHChangeNotify($eventId, 0x1005, $shortcutPath, [IntPtr]::Zero)
}
[EasyTranslate.ShortcutShell]::SHChangeNotify(0x00001000, 0x1005, $desktop, [IntPtr]::Zero) # UPDATEDIR

Write-Host 'EasyUnderstand shortcuts are ready in the Start menu and on the Desktop.'
Write-Host 'Press Ctrl+Alt+T to start it; Ctrl+Alt+E explains selected text once it is running.'
