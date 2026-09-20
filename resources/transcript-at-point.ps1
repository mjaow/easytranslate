# Report what sits under a screen point, using UI Automation.
#
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File transcript-at-point.ps1 <x> <y>
#
# Prints, one per line:
#   BUTTON:<name>   accessible name of the nearest button up the tree, if any
#   LINE:<text>     the line of text under the point, if the app exposes text there
#   CHAIN:<...>     one line per ancestor, for diagnostics
#
# Deciding whether that is a transcript line happens in the caller
# (src/core/transcript.ts), where it can be unit-tested. This script only reports.
#
# Exits 0 always; printing nothing is an ordinary outcome. Coordinates are physical
# screen pixels.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# WindowsBase carries System.Windows.Point, which UIAutomationClient does not pull in.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase

$point = New-Object System.Windows.Point([double]$args[0], [double]$args[1])

function Out-Line([string]$prefix, [string]$text) {
  # Keep each report on one line so the caller can parse it line by line.
  $flat = ($text -replace '[\r\n]+', ' ').Trim()
  if ($flat.Length -gt 0) { [Console]::Out.WriteLine($prefix + $flat) }
}

try {
  $element = [System.Windows.Automation.AutomationElement]::FromPoint($point)
  if ($null -eq $element) { exit 0 }

  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $buttonType = [System.Windows.Automation.ControlType]::Button
  $current = $element
  $textPattern = $null
  $button = $null
  $depth = 0

  while ($null -ne $current -and $depth -lt 12) {
    $c = $current.Current
    Out-Line 'CHAIN:' ("{0} {1} id='{2}' class='{3}' name='{4}'" -f $depth, $c.ControlType.ProgrammaticName, $c.AutomationId, $c.ClassName, $c.Name)

    # The nearest button: a transcript line is a button named "<time> <text>".
    if ($null -eq $button -and $c.ControlType -eq $buttonType -and $c.Name) { $button = $c.Name }

    # In Chromium the leaf under the pointer is usually a plain container; TextPattern
    # lives on the document above it, so keep walking until something exposes it.
    if ($null -eq $textPattern) {
      try { $textPattern = $current.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern) } catch { }
    }

    $current = $walker.GetParent($current)
    $depth++
  }

  if ($null -ne $button) { Out-Line 'BUTTON:' $button }

  if ($null -ne $textPattern) {
    $range = $textPattern.RangeFromPoint($point)
    if ($null -ne $range) {
      # A line is the right unit for a transcript entry: paragraph would pull in
      # neighbouring lines, and word would lose the context the model needs.
      $range.ExpandToEnclosingUnit([System.Windows.Automation.Text.TextUnit]::Line)
      Out-Line 'LINE:' ($range.GetText(600))
    }
  }
}
catch {
  # Not being able to read a point is normal — over a video, or an app that exposes
  # nothing. Stay silent and let the caller move on.
  exit 0
}
