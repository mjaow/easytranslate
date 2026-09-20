/**
 * Latency benchmark against a live provider. Skipped unless BENCH=1, so it never
 * runs as part of `npm test` (it needs a model and costs time or money).
 *
 *   BENCH=1 npx vitest run test/bench.test.ts
 */
import { describe, it, expect } from 'vitest'
import { OllamaProvider } from '../src/providers/llm/ollama.js'
import { SectionParser, detectMode } from '../src/core/explain.js'

const RUN = process.env.BENCH === '1'
const MODEL = process.env.BENCH_MODEL ?? 'qwen2.5:3b'

const CASES = [
  { label: 'PASSAGE', text: "He's just grandstanding for the base." },
  { label: 'WORD', text: 'grandstanding', context: "He's just grandstanding for the base." }
]

describe.skipIf(!RUN)(`latency: ${MODEL}`, () => {
  for (const c of CASES) {
    it(
      `${c.label}: "${c.text}"`,
      async () => {
        const provider = new OllamaProvider({ apiKey: null, model: MODEL })
        const mode = c.context ? 'word' : detectMode(c.text)
        const parser = new SectionParser()

        const t0 = Date.now()
        let firstToken = 0
        let chars = 0

        for await (const chunk of provider.explain(
          { mode, text: c.text, context: c.context },
          new AbortController().signal
        )) {
          if (!firstToken) firstToken = Date.now() - t0
          chars += chunk.length
          parser.push(chunk)
        }
        const total = Date.now() - t0
        const result = parser.end()

        console.log(`\n  ${c.label}  first token ${firstToken}ms   complete ${total}ms   ${chars} chars`)
        console.log(`  zh: ${result.zh ?? '(none)'}`)
        if (result.en) console.log(`  en: ${result.en}`)
        if (result.ipa) console.log(`  ipa: ${result.ipa}`)
        if (result.here) console.log(`  here: ${result.here}`)
        if (result.notable) console.log(`  notable: ${result.notable.join(' | ')}`)

        // The point of the benchmark is the numbers, but a run that parses nothing
        // means the model ignored the section format — worth failing on.
        expect(Object.keys(result).length).toBeGreaterThan(0)
      },
      180000
    )
  }
})
