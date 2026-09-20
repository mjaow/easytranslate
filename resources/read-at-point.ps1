# Read the line of text under a screen point, using UI Automation.
#
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File read-at-point.ps1 <x> <y>
#
# Prints the line to stdout, or nothing at all when the point is not over readable
# text — a video frame, an image, a blank area. Exits 0 either way; an empty result
# is an ordinary outcome, not an error.
#
# This is exact where OCR is a guess: the text comes from the application's own
# accessibility tree, so there is nothing to misread. It only works where an app
# exposes its text, which rules out video pixels and images — that is what the
# screen-reading fallback is for.
#
# Coordinates are physical screen pixels.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# WindowsBase carries System.Windows.Point, which UIAutomationClient does not pull in.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase

$point = New-Object System.Windows.Point([double]$args[0], [double]$args[1])

try {
  $element = [System.Windows.Automation.AutomationElement]::FromPoint($point)
  if ($null -eq $element) { exit 0 }

  # In Chromium the leaf under the pointer is usually a plain container; TextPattern
  # lives on the document above it, so walk up until something exposes it.
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $current = $element
  $textPattern = $null
  $depth = 0

  while ($null -ne $current -and $depth -lt 12) {
    try {
      $textPattern = $current.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      if ($null -ne $textPattern) { break }
    } catch { }
    $current = $walker.GetParent($current)
    $depth++
  }

  if ($null -eq $textPattern) {
    # No text here. Fall back to the element's own accessible name, which covers
    # simple controls that carry their label rather than a text range.
    $name = $element.Current.Name
    if ($name -and $name.Trim().Length -gt 1) { [Console]::Out.WriteLine($name) }
    exit 0
  }

  $range = $textPattern.RangeFromPoint($point)
  if ($null -eq $range) { exit 0 }

  # A line is the right unit for a subtitle or a transcript entry. Paragraph would
  # pull in neighbouring lines, and Word would lose the context the model needs.
  $range.ExpandToEnclosingUnit([System.Windows.Automation.Text.TextUnit]::Line)
  $text = $range.GetText(600)

  if ($text -and $text.Trim().Length -gt 0) { [Console]::Out.WriteLine($text.Trim()) }
}
catch {
  # Not being able to read a point is normal — over a video, or an app that exposes
  # nothing. Stay silent and let the caller fall back.
  exit 0
}
