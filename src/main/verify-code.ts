/**
 * Self-test for code explanations: `npm run verify:code`.
 *
 * Whether a selection is code is the model's decision, so the only honest check is
 * to ask the model. This sends a mix of real snippets and prose that merely mentions
 * code through the configured provider, checks the verdict each ordinary answer
 * carries, and then — as the popup's button would — asks for the snippets as code
 * and checks the code sections come back. A few hundred tokens per case, on whatever
 * model Settings points at.
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
  {
    label: 'Python with a bug',
    text: 'def avg(xs):\n    return sum(xs) / len(xs)',
    code: true
  },
  { label: 'news sentence', text: 'The president calls for federal involvement as opposition grows.', code: false },
  { label: 'prose mentioning languages', text: 'I learned C++ and Rust last year, and Go the year before.', code: false },
  { label: 'prose with a shortcut', text: 'Use Ctrl+C to copy and Ctrl+V to paste, then press Enter.', code: false },
  { label: 'two-word term', text: 'the base', code: false },
  { label: 'transcript line', text: 'so that given a complex agented workflow, you can efficiently hone in', code: false }
]

let passed = 0
let failed = 0
let warned = 0

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
  console.log(
    `  provider: ${config.llm.provider}  model: ${config.llm.models[config.llm.provider]}` +
      (config.llm.codeModel ? `  code model: ${config.llm.codeModel}` : '') +
      '\n'
  )
  // The second step goes to the code model when one is set, as the button does.
  // `--model <id>` tries another one without changing Settings, to compare candidates.
  const modelFlag = process.argv.indexOf('--model')
  const codeModel = (modelFlag > 0 ? process.argv[modelFlag + 1] : '') || config.llm.codeModel.trim()
  if (codeModel) console.log(`  code model for this run: ${codeModel}\n`)
  const codeProvider = codeModel ? createLlmProvider(config, secret, codeModel) : provider

  // `npm run verify:code -- path/to/snippet` prints the full explanation of that file
  // instead — the way to judge the answer's quality by eye, not just its shape.
  const file = process.argv[process.argv.indexOf('--verify-code') + 1]
  if (file && !file.startsWith('-')) {
    const { readFileSync } = await import('node:fs')
    const text = readFileSync(file, 'utf8')
    const parser = new SectionParser()
    const started = Date.now()
    for await (const chunk of codeProvider.explain({ mode: 'code', text, raw: keepShape(text) }, new AbortController().signal)) {
      parser.push(chunk)
    }
    const r = parser.end()
    const show = (label: string, value: string | string[] | undefined): void => {
      if (!value || value.length === 0) return
      console.log(`  ${label}`)
      for (const line of Array.isArray(value) ? value : value.split('\n')) console.log(`    ${line}`)
    }
    show('LANG', r.lang)
    show('ZH', r.zh)
    show('EN', r.en)
    show('WHY', r.why)
    show('STEPS', r.steps)
    show('DESIGN', r.design)
    show('ISSUES', r.issues)
    show('CONCEPTS', r.concepts)
    console.log(`\n  ${Date.now() - started}ms\n`)
    app.exit(0)
    return
  }

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
    const elapsed = Date.now() - started
    const verdict = r.isCode === true

    const detail = `verdict ${verdict ? 'yes' : 'no'}, ${mode}: ${(r.zh ?? '').slice(0, 24)}…, ${elapsed}ms`
    if (c.code || verdict === c.code) {
      // Missing the button on real code is the failure that matters.
      check(verdict === c.code, `${c.code ? 'code' : 'prose'}: ${c.label}`, detail)
    } else {
      // A "yes" on prose only costs an unneeded button, and models differ on the
      // borderline; report it without failing the run.
      warned++
      console.log(`  WARN  prose: ${c.label} — ${detail} (the popup would offer a button it need not)`)
    }
    if (!c.code) continue

    // The second step, as the button would ask for it.
    const codeParser = new SectionParser()
    const codeStarted = Date.now()
    try {
      for await (const chunk of codeProvider.explain({ mode: 'code', text: c.text, raw }, new AbortController().signal)) {
        codeParser.push(chunk)
      }
    } catch (err) {
      check(false, `  …explained as code`, `request failed: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    const code = codeParser.end()
    check(
      Boolean(code.lang && code.steps?.length && code.zh && code.en && code.why),
      `  …explained as code`,
      `${code.lang ?? '?'}, why ${code.why ? 'yes' : 'MISSING'}, ${code.steps?.length ?? 0} steps, ${code.design?.length ?? 0} design, ${code.issues?.length ?? 0} issues, ${code.concepts?.length ?? 0} concepts, ${Date.now() - codeStarted}ms`
    )
  }

  const warnings = warned ? `, ${warned} warning${warned === 1 ? '' : 's'}` : ''
  console.log(
    `\n${failed === 0 ? `All ${passed} checks passed${warnings}.` : `${failed} of ${passed + failed} FAILED${warnings}.`}\n`
  )
  app.exit(failed === 0 ? 0 : 1)
}
