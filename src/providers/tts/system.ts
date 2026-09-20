import { execFile } from 'node:child_process'
import { readFile, writeFile, unlink, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TtsError, type SynthResult, type TtsProvider } from './types.js'

const EXEC_TIMEOUT_MS = 15000

/**
 * Offline Windows voices via SAPI (System.Speech).
 *
 * Less natural than the neural voices, but it always works: no network, no API key,
 * nothing to break. It carries read-aloud whenever the Edge provider can't.
 */
export class SystemTtsProvider implements TtsProvider {
  readonly id = 'system' as const
  readonly label = 'Windows system voice (offline)'

  constructor(private readonly voiceName?: string) {}

  async synth(text: string, rate: number): Promise<SynthResult> {
    if (process.platform !== 'win32') {
      throw new TtsError('The system voice is only available on Windows.')
    }

    const dir = await mkdtemp(join(tmpdir(), 'easytranslate-'))
    const inFile = join(dir, 'in.txt')
    const outFile = join(dir, 'out.wav')

    try {
      // The text comes from arbitrary web pages, so it never goes near the command
      // line — PowerShell reads it from a file. Nothing the user selects can be
      // interpreted as script.
      await writeFile(inFile, text, 'utf8')
      await this.run(inFile, outFile, rate)
      const data = await readFile(outFile)
      if (data.length === 0) throw new TtsError('The system voice produced no audio.')
      return { data, mime: 'audio/wav' }
    } finally {
      await Promise.allSettled([unlink(inFile), unlink(outFile)])
    }
  }

  private async run(inFile: string, outFile: string, rate: number): Promise<void> {
    // SAPI's rate is an integer from -10 to 10; ours is a percentage offset.
    const sapiRate = Math.max(-10, Math.min(10, Math.round(rate / 10)))
    const scriptFile = inFile.replace(/in\.txt$/, 'speak.ps1')

    // Everything variable arrives as a positional argument, so neither the selected
    // text nor the voice name is ever parsed as script. Note this needs -File, not
    // -Command: only -File populates $args.
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText($args[0], [System.Text.Encoding]::UTF8)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($args.Count -gt 3 -and $args[3]) { try { $synth.SelectVoice($args[3]) } catch { } }
  if ($synth.Voice.Culture.Name -ne 'en-US') {
    # Fall back to any adult en-US voice rather than the system default, since the
    # whole point is hearing an American accent.
    try {
      $synth.SelectVoiceByHints(
        [System.Speech.Synthesis.VoiceGender]::NotSet,
        [System.Speech.Synthesis.VoiceAge]::Adult, 0,
        [System.Globalization.CultureInfo]::GetCultureInfo('en-US'))
    } catch { }
  }
  $synth.Rate = [int]$args[2]
  $synth.SetOutputToWaveFile($args[1])
  $synth.Speak($text)
} finally {
  $synth.Dispose()
}
`.trim()

    await writeFile(scriptFile, script, 'utf8')

    const argv = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptFile,
      inFile,
      outFile,
      String(sapiRate)
    ]
    if (this.voiceName) argv.push(this.voiceName)

    try {
      await new Promise<void>((resolve, reject) => {
        execFile('powershell.exe', argv, { timeout: EXEC_TIMEOUT_MS }, (err, _out, stderr) => {
          if (err) {
            reject(new TtsError('The Windows system voice failed.', stderr?.trim() || err.message))
            return
          }
          resolve()
        })
      })
    } finally {
      await unlink(scriptFile).catch(() => {})
    }
  }
}
