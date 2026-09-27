import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extension = JSON.parse(await readFile(join(root, 'extension/manifest.json'), 'utf8'))
const id = createHash('sha256').update(Buffer.from(extension.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)))
const folder = join(root, 'out', 'native-host')
await mkdir(folder, { recursive: true })
const hostEntry = join(root, 'out/main/native-host.js')
await access(hostEntry)
const manifest = { name: 'com.easytranslate.video', description: 'EasyTranslate video analysis', type: 'stdio', path: '', allowed_origins: [`chrome-extension://${id}/`] }
if (process.platform === 'win32') {
  const electron = join(root, 'node_modules/electron/dist/electron.exe')
  await access(electron)
  // Windows native messaging supports a batch launcher; quoted paths handle spaces.
  // Reject percent/newline expansion rather than create an ambiguous batch command.
  if (/[\r\n%]/.test(root)) throw new Error('Move the checkout to a path without percent signs or line breaks.')
  manifest.path = join(folder, 'host.cmd')
  await writeFile(manifest.path, `@echo off\r\n"${process.execPath}" "${join(folder, 'bridge.cjs')}" %*\r\n`)
  const manifestFile = join(folder, 'com.easytranslate.video.json')
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2))
  if (!process.argv.includes('--prepare-only')) {
    for (const browser of ['Google\\Chrome', 'Microsoft\\Edge']) {
      execFileSync('reg.exe', ['ADD', `HKCU\\Software\\${browser}\\NativeMessagingHosts\\${manifest.name}`, '/ve', '/t', 'REG_SZ', '/d', manifestFile, '/f'], { stdio: 'pipe', windowsHide: true })
    }
  }
} else if (process.platform === 'darwin') {
  const electron = join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  await access(electron)
  const quote = s => `'${s.replace(/'/g, `'"'"'`)}'`
  manifest.path = join(folder, 'host.sh')
  await writeFile(manifest.path, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(folder, 'bridge.cjs'))} "$@"\n`, { mode: 0o755 })
  for (const browser of ['Google/Chrome', 'Microsoft Edge']) {
    const dir = join(homedir(), 'Library/Application Support', browser, 'NativeMessagingHosts')
    if (!process.argv.includes('--prepare-only')) { await mkdir(dir, { recursive: true }); await writeFile(join(dir, `${manifest.name}.json`), JSON.stringify(manifest, null, 2)) }
  }
} else throw new Error('The companion installer currently supports Windows and macOS.')
console.log(`Extension ID: ${id}\nLoad unpacked extension from: ${join(root, 'out/extension')}\n${process.argv.includes('--prepare-only') ? 'Launcher prepared (registration skipped).' : 'Chrome and Edge native host registered for your user.'}`)
