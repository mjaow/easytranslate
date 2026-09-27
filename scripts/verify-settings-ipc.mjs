import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import electron from 'electron'

const directory = mkdtempSync(join(tmpdir(), 'easytranslate-settings-test-'))
const env = { ...process.env, EASYTRANSLATE_SETTINGS_VERIFY_DIR: directory }
delete env.ELECTRON_RUN_AS_NODE
try {
  const code = await new Promise((done, fail) => {
    const child = spawn(electron, ['.', '--verify-settings'], { env, windowsHide: true, stdio: 'inherit' })
    child.on('error', fail); child.on('exit', code => done(code ?? 1))
  })
  process.exitCode = code
} finally {
  if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error('Unsafe verification cleanup path')
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
