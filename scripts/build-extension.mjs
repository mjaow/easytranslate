import { build } from 'esbuild'
import { mkdir, copyFile } from 'node:fs/promises'
const out = 'out/extension'
await mkdir(out, { recursive: true })
await build({ entryPoints: ['src/main/native-bridge.ts'], outfile: 'out/native-host/bridge.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20' })
await build({ entryPoints: ['extension/background.ts', 'extension/sidepanel.ts'], outdir: out, bundle: true, format: 'esm', target: 'chrome120', sourcemap: false })
await build({ entryPoints: ['extension/content.ts'], outdir: out, bundle: true, format: 'iife', target: 'chrome120' })
// executeScript(files) returns the last expression; esbuild's normal IIFE does not
// return its final expression. Expose the promise via globalName, then return it.
// Collector entry uses an explicit export so the promise survives bundling.
await build({ entryPoints: ['extension/collector.ts'], outfile: `${out}/collector.js`, bundle: true, format: 'iife', globalName: '__easytranslateCapture', target: 'chrome120', footer: { js: '__easytranslateCapture.default;' } })
for (const file of ['manifest.json', 'sidepanel.html', 'sidepanel.css', 'help.html']) await copyFile(`extension/${file}`, `${out}/${file}`)
console.log(`Browser extension built: ${out}`)
