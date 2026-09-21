# Capture a region of the screen and read the text in it.
#
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File snip-ocr.ps1 <x> <y> <w> <h> [lang]
#
# Prints the recognised text to stdout, or writes a line beginning with "ERROR:" to
# stderr and exits non-zero.
#
# Must be run by powershell.exe (Windows PowerShell 5.1), NOT pwsh 7: PowerShell 7
# dropped WinRT support, so [Windows.Media.Ocr.OcrEngine] does not resolve there at all.
#
# Coordinates are PHYSICAL screen pixels, which is what CopyFromScreen expects. The
# caller converts from Electron's device-independent pixels before invoking this.

$ErrorActionPreference = 'Stop'

# Chinese can come back from the zh recognizer, and the default console encoding
# would mangle it on the way to the parent process.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$x = [int]$args[0]
$y = [int]$args[1]
$w = [int]$args[2]
$h = [int]$args[3]
$lang = if ($args.Count -gt 4 -and $args[4]) { $args[4] } else { 'en-US' }

if ($w -lt 8 -or $h -lt 8) {
  [Console]::Error.WriteLine('ERROR: region is too small to read')
  exit 2
}

Add-Type -AssemblyName System.Drawing
# Supplies the AsTask extension used to await WinRT's IAsyncOperation. Without it the
# await helper below cannot be resolved.
Add-Type -AssemblyName System.Runtime.WindowsRuntime

# Every WinRT type must be referenced explicitly before use. Globalization.Language is
# the easy one to forget — omitting it fails late, at engine construction.
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]

# WinRT returns IAsyncOperation<T>; PowerShell has no await, so reach for the generic
# AsTask overload and block on it.
function Invoke-Await($operation, $resultType) {
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
  $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation)).GetAwaiter().GetResult()
}

$png = Join-Path $env:TEMP ("easytranslate-snip-{0}.png" -f [guid]::NewGuid())

try {
  # --- capture ---------------------------------------------------------------
  $bitmap = New-Object System.Drawing.Bitmap $w, $h
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h))
  $graphics.Dispose()
  $bitmap.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()

  # --- recognise -------------------------------------------------------------
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage(
    (New-Object Windows.Globalization.Language $lang))
  if ($null -eq $engine) {
    # Fall back to whatever the user's profile provides rather than failing outright.
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  }
  if ($null -eq $engine) {
    [Console]::Error.WriteLine("ERROR: no OCR language pack available for '$lang'")
    exit 3
  }

  $file = Invoke-Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($png)) `
    ([Windows.Storage.StorageFile])
  $stream = Invoke-Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) `
    ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Invoke-Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) `
    ([Windows.Graphics.Imaging.BitmapDecoder])
  $softwareBitmap = Invoke-Await ($decoder.GetSoftwareBitmapAsync()) `
    ([Windows.Graphics.Imaging.SoftwareBitmap])

  $result = Invoke-Await ($engine.RecognizeAsync($softwareBitmap)) `
    ([Windows.Media.Ocr.OcrResult])

  # One line per OCR line, with where it sat in the captured image: "x y w h<TAB>text".
  # The caller uses the position to keep the line that was pointed at and drop the
  # rest — a logo, a watermark, a control strip — that shared the captured area.
  foreach ($line in $result.Lines) {
    $l = $null; $t = $null; $r = $null; $b = $null
    foreach ($word in $line.Words) {
      $wr = $word.BoundingRect
      if ($null -eq $l -or $wr.X -lt $l) { $l = $wr.X }
      if ($null -eq $t -or $wr.Y -lt $t) { $t = $wr.Y }
      if ($null -eq $r -or ($wr.X + $wr.Width) -gt $r) { $r = $wr.X + $wr.Width }
      if ($null -eq $b -or ($wr.Y + $wr.Height) -gt $b) { $b = $wr.Y + $wr.Height }
    }
    if ($null -eq $l) { $l = 0; $t = 0; $r = 0; $b = 0 }
    [Console]::Out.WriteLine(("{0} {1} {2} {3}`t{4}" -f [int]$l, [int]$t, [int]($r - $l), [int]($b - $t), $line.Text))
  }

  $stream.Dispose()
}
catch {
  [Console]::Error.WriteLine("ERROR: $($_.Exception.Message)")
  exit 1
}
finally {
  Remove-Item $png -ErrorAction SilentlyContinue
}
