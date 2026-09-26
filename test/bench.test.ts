/**
 * Latency benchmark against a live provider. Skipped unless BENCH=1, so it never
 * runs as part of `npm test` (it needs a model and costs time or money).
 *
 *   BENCH=1 npx vitest run test/bench.test.ts
 */
import { describe, it, expect } from 'vitest'
import { OllamaProvider } from '../src/providers/llm/ollama.js'
import { SectionParser, detectMode } from '../src/core/explain.js'
import { withDictionaryPronunciations, withPronunciationHints } from '../src/core/pronunciation.js'

const RUN = process.env.BENCH === '1'
const MODEL = process.env.BENCH_MODEL ?? 'qwen2.5:3b'

const CASES = [
  {
    label: 'PASSAGE',
    text:
      'Ukraine has hit Moscow with what local authorities said was the largest ever ' +
      'drone attack on the Russian capital, setting a major oil refinery ablaze.'
  },
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
        const req = withPronunciationHints({ mode, text: c.text, context: c.context })

        const t0 = Date.now()
        let firstToken = 0
        let chars = 0

        for await (const chunk of provider.explain(
          req,
          new AbortController().signal
        )) {
          if (!firstToken) firstToken = Date.now() - t0
          chars += chunk.length
          parser.push(chunk)
        }
        const total = Date.now() - t0
        const result = withDictionaryPronunciations(req, parser.end())

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
