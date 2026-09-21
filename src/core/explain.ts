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
## CODE
yes or no. "yes" only if the selection AS A WHOLE is something a computer would run
or parse: a snippet in any programming language, a shell command, a query, a config
or data fragment (JSON, YAML, ...), a stack trace. A sentence written for a person is
"no", even when it names a language, a command, a key combination or a file.
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
## CODE
yes or no. "yes" only if the selection AS A WHOLE is something a computer would run
or parse: a snippet in any programming language, a shell command, a query, a config
or data fragment (JSON, YAML, ...), a stack trace. A sentence written for a person is
"no", even when it names a language, a command, a key combination or a file.
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

const CODE_PROMPT = `You help a native Chinese speaker who is a working developer and reads English at an
intermediate level. Write Chinese in Simplified characters.

The selection is source code. Explain it the way a senior colleague would in a code
review: what problem it solves and why it is built this way — not a line-by-line
paraphrase. Do NOT translate identifiers. Judge only the code shown: never invent code
that is not there, and say when something cannot be known from the snippet.

Answer ONLY in the section format given. Every section header is on its own line.
No preamble, no closing remarks, no markdown beyond the headers and backticks. This is
a longer answer than a word lookup: a section may run to a short paragraph, and a
list to 3–8 lines.

Sections, in this exact order:
## LANG
The language, one word (Python, TypeScript, SQL, Bash, Go, Rust, JSON, ...). Nothing else.
## ZH
一两句话：这段代码是什么、整体做什么。
## EN
The same in plain English. This section must be in English.
## WHY
用中文说明：它解决什么问题、为什么需要它、和更简单的做法相比好在哪里。3 到 5 句。
如果它实现的是一个有名字的算法、设计模式或论文里的机制（比如多头注意力、LRU 缓存），
先用一两句把那个概念本身讲清楚，再说这段代码是怎么体现它的。
## STEPS
3 到 8 行，按执行顺序。每行：代码片段（用反引号原样引用几个 token）→ 它做了什么，
中文，不超过 30 字。不要编号。
## DESIGN
2 到 4 行。每行：一个值得注意的写法或取舍 → 为什么这样写、换一种写法会怎样。
中文。只讲这段代码里确实存在的选择。
## ISSUES
这段代码里的 bug、遗漏的边界情况、性能或可读性问题、与惯用写法的偏差。每行一条：
先引用出问题的代码，再说后果，再说改法。只写能从这段代码本身确定的问题；拿不准
的要写"可能"。确实没有发现问题就写 (none)。
## CONCEPTS
Up to 4 concepts in the snippet a developer may not know, most important first.
One per line, middle dot as separator:
term · 中文名称 · 一句中文说明它在这里的作用

For example, given "def avg(xs):\n    return sum(xs) / len(xs)":
## STEPS
\`sum(xs)\` → 把序列里的数加起来
\`len(xs)\` → 取元素个数
\`sum(xs) / len(xs)\` → 相除得到平均值并返回
## DESIGN
\`sum(xs) / len(xs)\` 直接用内置函数 → 简洁，但会把序列遍历两次；对大数据可用一次循环同时累加和计数
## ISSUES
\`len(xs)\` 为 0 时抛出 ZeroDivisionError → 空列表会让调用方崩溃 → 先判空，返回 0 或抛出带说明的异常
\`xs\` 若是生成器，\`sum\` 会把它耗尽，随后 \`len\` 直接报错 → 只接受序列，或先转成 list
## CONCEPTS
built-in functions · 内置函数 · sum、len 由解释器实现，比手写循环更快更可读

Write (none) under ISSUES or CONCEPTS only when there is genuinely nothing to list.`

export function systemPrompt(mode: ExplainMode): string {
  if (mode === 'word') return WORD_PROMPT
  if (mode === 'code') return CODE_PROMPT
  return PASSAGE_PROMPT
}

/** Fence the selection so line breaks and indentation reach the model as they are. */
function fenced(text: string): string {
  return `\`\`\`\n${text}\n\`\`\``
}

export function userPrompt(req: ExplainRequest): string {
  const selection = req.raw ?? req.text
  if (req.mode === 'word') {
    const sentence = req.context?.trim()
    return sentence && sentence !== req.text
      ? `Sentence: ${sentence}\n\nExplain this term from it: ${req.text}`
      : `Explain this selection:\n\n${fenced(selection)}`
  }
  return `Explain this selection:\n\n${fenced(selection)}`
}

// ------------------------------------------------------- incremental parsing

const HEADERS: Record<string, keyof Explanation> = {
  IPA: 'ipa',
  POS: 'pos',
  ZH: 'zh',
  EN: 'en',
  HERE: 'here',
  EX: 'example',
  NOTABLE: 'notable',
  CODE: 'isCode',
  LANG: 'lang',
  WHY: 'why',
  STEPS: 'steps',
  DESIGN: 'design',
  ISSUES: 'issues',
  CONCEPTS: 'concepts'
}

/** Sections that are a list, one item per line, rather than running text. */
const LIST_SECTIONS = new Set<keyof Explanation>(['notable', 'steps', 'design', 'issues', 'concepts'])

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
      if (LIST_SECTIONS.has(key)) continue
      if (joined) (out as Record<string, unknown>)[key] = joined
    }

    // The section still being written isn't in `lines` yet — surface it so text
    // appears as it streams instead of arriving a paragraph at a time.
    if (this.current && this.buffer.trim() && !LIST_SECTIONS.has(this.current)) {
      const settled = (this.lines.get(this.current) ?? []).join('\n')
      const combined = `${settled}\n${this.buffer}`.trim()
      if (combined) (out as Record<string, unknown>)[this.current] = combined
    }

    // The verdict arrives as a word; the popup wants a boolean.
    const verdict = out.isCode as unknown
    if (typeof verdict === 'string') out.isCode = /^\s*yes/i.test(verdict)

    for (const key of LIST_SECTIONS) {
      const lines = this.lines.get(key)
      if (!lines) continue
      const items = lines
        // Models number lists however they like; the popup does its own numbering.
        .map((l) => l.trim().replace(/^(?:\d+[.)]|[-*•])\s*/, ''))
        .filter((l) => l && l !== '(none)' && l !== '（none）')
      if (items.length) (out as Record<string, unknown>)[key] = items
    }
    return out
  }
}
