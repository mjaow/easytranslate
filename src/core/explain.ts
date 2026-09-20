/**
 * Prompt construction and incremental parsing of the model's reply.
 *
 * The model answers in fixed `## SECTION` blocks rather than JSON. Streaming JSON is
 * awkward to render half-arrived — you can't show a field until its closing quote
 * lands — whereas sections let the popup fill in top-down as tokens arrive, which is
 * most of what makes this feel instant.
 */
import type { Explanation, ExplainMode, ExplainRequest } from '../shared/types.js'
import { wordCount } from './tokenize.js'

/** Selections at or under this many words are treated as a term, not a passage. */
const WORD_MODE_MAX_WORDS = 3

export function detectMode(text: string): ExplainMode {
  return wordCount(text) <= WORD_MODE_MAX_WORDS ? 'word' : 'passage'
}

const SHARED_RULES = `You help a native Chinese speaker who reads English at an intermediate level.
Write Chinese in Simplified characters. Use American English conventions throughout.

Answer ONLY in the section format given. Every section header is on its own line.
No preamble, no closing remarks, no markdown beyond the headers themselves.
Keep each section to one or two sentences — this renders in a small popup.`

const WORD_PROMPT = `${SHARED_RULES}

Explain the term as it is used in the given sentence — not its dictionary entry in
general. If the term is a phrasal verb, idiom or slang, say so plainly.

Sections, in this exact order:
## IPA
American English pronunciation in IPA, wrapped in forward slashes. Nothing else.
## POS
Part of speech in English, lowercase (noun, verb, adjective, idiom, ...). Nothing else.
## ZH
The Chinese meaning it carries HERE. Just the meaning, no explanation.
## EN
A plain-English definition a learner would understand. Avoid using the term itself.
## HERE
One sentence in Chinese explaining what it conveys in this particular sentence and why.
## EX
One natural example sentence in English, then its Chinese translation on the next line.`

const PASSAGE_PROMPT = `${SHARED_RULES}

Sections, in this exact order:
## ZH
A natural Chinese translation. Convey the meaning as a Chinese speaker would say it —
do not translate word by word.
## EN
The same passage restated in SIMPLER ENGLISH. This section must be in English, never
Chinese — its whole purpose is to give the reader an easier English version.
## NOTABLE
The words and phrases in this passage an intermediate learner is most likely NOT to
know. Include uncommon or advanced vocabulary, technical terms, idioms, slang, phrasal
verbs and cultural references — ordinary hard words count, not only idioms.
Pick the 2 to 5 hardest. Skip anything an intermediate reader already knows.
One per line, using the middle dot as separator:
term · /American IPA/ · Chinese meaning · a short example sentence

The example must be a NEW sentence of your own, not the one being explained, and short
enough to read at a glance — under about ten words.

For example, given "setting a major oil refinery ablaze", this section would be:
refinery · /rɪˈfaɪnəri/ · 炼油厂 · The refinery processes crude oil into fuel.
ablaze · /əˈbleɪz/ · 着火的，熊熊燃烧的 · Firefighters arrived to find the barn ablaze.

Almost every real passage contains something worth listing. Only write (none) if the
passage is genuinely all common words.`

export function systemPrompt(mode: ExplainMode): string {
  return mode === 'word' ? WORD_PROMPT : PASSAGE_PROMPT
}

export function userPrompt(req: ExplainRequest): string {
  if (req.mode === 'word') {
    const sentence = req.context?.trim()
    return sentence && sentence !== req.text
      ? `Sentence: ${sentence}\n\nExplain this term from it: ${req.text}`
      : `Explain this term: ${req.text}`
  }
  return `Explain this passage:\n\n${req.text}`
}

// ------------------------------------------------------- incremental parsing

const HEADERS: Record<string, keyof Explanation> = {
  IPA: 'ipa',
  POS: 'pos',
  ZH: 'zh',
  EN: 'en',
  HERE: 'here',
  EX: 'example',
  NOTABLE: 'notable'
}

const HEADER_RE = /^##\s*([A-Z]+)\s*$/

/**
 * Feeds streamed chunks in and yields the explanation so far.
 *
 * Chunk boundaries fall anywhere — mid-word, mid-header, even between the `#` and the
 * `#` — so everything is buffered until a newline proves a line is complete. The one
 * exception is the line currently being written, which is exposed as partial text so
 * the user sees words appear rather than whole paragraphs popping in.
 */
export class SectionParser {
  private buffer = ''
  private current: keyof Explanation | null = null
  private readonly lines = new Map<keyof Explanation, string[]>()

  push(chunk: string): Explanation {
    this.buffer += chunk

    let nl = this.buffer.indexOf('\n')
    while (nl !== -1) {
      this.consumeLine(this.buffer.slice(0, nl))
      this.buffer = this.buffer.slice(nl + 1)
      nl = this.buffer.indexOf('\n')
    }
    return this.snapshot()
  }

  /** Flush the trailing partial line. Call once the stream ends. */
  end(): Explanation {
    if (this.buffer) {
      this.consumeLine(this.buffer)
      this.buffer = ''
    }
    return this.snapshot()
  }

  private consumeLine(line: string): void {
    const header = HEADER_RE.exec(line.trim())
    if (header) {
      const key = HEADERS[header[1]]
      // An unrecognised header still ends the previous section — better to drop one
      // unexpected block than to append it to the last valid one.
      this.current = key ?? null
      if (key && !this.lines.has(key)) this.lines.set(key, [])
      return
    }
    if (!this.current) return
    const arr = this.lines.get(this.current)
    if (arr) arr.push(line)
  }

  private snapshot(): Explanation {
    const out: Explanation = {}

    for (const [key, lines] of this.lines) {
      const joined = lines.join('\n').trim()
      if (key === 'notable') continue
      if (joined) (out as Record<string, unknown>)[key] = joined
    }

    // The section still being written isn't in `lines` yet — surface it so text
    // appears as it streams instead of arriving a paragraph at a time.
    if (this.current && this.buffer.trim() && this.current !== 'notable') {
      const settled = (this.lines.get(this.current) ?? []).join('\n')
      const combined = `${settled}\n${this.buffer}`.trim()
      if (combined) (out as Record<string, unknown>)[this.current] = combined
    }

    const notable = this.lines.get('notable')
    if (notable) {
      const items = notable
        .map((l) => l.trim())
        .filter((l) => l && l !== '(none)' && l !== '（none）')
      if (items.length) out.notable = items
    }
    return out
  }
}
