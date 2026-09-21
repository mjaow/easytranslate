/**
 * Self-test for code explanations: `npm run verify:code`.
 *
 * Whether a selection is code is the model's decision, so the only honest check is
 * to ask the model. This sends a mix of real snippets and prose that merely mentions
 * code through the configured provider and checks that code comes back with the
 * code sections (LANG, STEPS) and prose does not. It spends a few hundred tokens per
 * case, on whatever model Settings points at.
 */
import { app } from 'electron'
import { loadConfig, getSecret } from '../core/config.js'
import { createLlmProvider } from '../providers/llm/registry.js'
import { detectMode, SectionParser } from '../core/explain.js'
import { keepShape } from './capture.js'

const CASES: { label: string; text: string; code: boolean }[] = [
  { label: 'Python function', text: 'def total(items):\n    return sum(i.price for i in items)', code: true },
  { label: 'Python one-liner (word-length)', text: 'print("hello, world")', code: true },
  { label: 'TypeScript arrow', text: 'const add = (a: number, b: number): number => a + b;', code: true },
  { label: 'SQL', text: 'SELECT id, name FROM users WHERE age > 30 ORDER BY name;', code: true },
  { label: 'Bash', text: 'for f in *.txt; do echo "$f"; done', code: true },
  { label: 'JSON', text: '{"name": "easytranslate", "version": "0.1.0", "private": true}', code: true },
  { label: 'news sentence', text: 'The president calls for federal involvement as opposition grows.', code: false },
  { label: 'prose mentioning languages', text: 'I learned C++ and Rust last year, and Go the year before.', code: false },
  { label: 'prose with a shortcut', text: 'Use Ctrl+C to copy and Ctrl+V to paste, then press Enter.', code: false },
  { label: 'two-word term', text: 'the base', code: false },
  { label: 'transcript line', text: 'so that given a complex agented workflow, you can efficiently hone in', code: false }
]

let passed = 0
let failed = 0

function check(ok: boolean, label: string, detail = ''): void {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

export async function runCodeVerification(): Promise<void> {
  console.log('\nEasyTranslate — code-or-prose self-test (asks the configured model)\n')

  const config = loadConfig()
  const secret = getSecret(config.llm.provider)
  let provider
  try {
    provider = createLlmProvider(config, secret)
  } catch (err) {
    console.log(`  Cannot run: ${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(2)
    return
  }
  console.log(`  provider: ${config.llm.provider}  model: ${config.llm.models[config.llm.provider]}\n`)

  for (const c of CASES) {
    const raw = keepShape(c.text)
    const mode = detectMode(c.text)
    const parser = new SectionParser()
    const started = Date.now()
    try {
      for await (const chunk of provider.explain({ mode, text: c.text, raw }, new AbortController().signal)) {
        parser.push(chunk)
      }
    } catch (err) {
      check(false, c.label, `request failed: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    const r = parser.end()
    const gotCode = Boolean(r.lang || r.steps?.length)
    const elapsed = Date.now() - started

    const detail = gotCode
      ? `${r.lang ?? '?'}, ${r.steps?.length ?? 0} steps, ${r.concepts?.length ?? 0} concepts, ${elapsed}ms`
      : `${mode}: ${(r.zh ?? '').slice(0, 30)}…, ${elapsed}ms`
    check(gotCode === c.code, `${c.code ? 'code' : 'prose'}: ${c.label}`, detail)

    // Both kinds must still produce the two sections the popup leads with.
    if (gotCode === c.code) {
      check(Boolean(r.zh && r.en), `  …with ZH and EN filled in`, r.zh && r.en ? '' : `zh=${!!r.zh} en=${!!r.en}`)
    }
  }

  console.log(
    `\n${failed === 0 ? `All ${passed} checks passed.` : `${failed} of ${passed + failed} FAILED.`}\n`
  )
  app.exit(failed === 0 ? 0 : 1)
}
