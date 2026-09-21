/**
 * Parsing one "hard word" line out of a passage explanation.
 *
 * The model is asked for `term · /IPA/ · Chinese meaning · example`, but models drift
 * on separators and omit fields — so this stays tolerant rather than dropping a line
 * it doesn't fully recognise. A term with nothing but a gloss is still useful.
 */
export interface NotableTerm {
  term: string
  ipa?: string
  gloss?: string
  example?: string
}

/** Separators models actually produce, in place of the requested middle dot. */
const SEPARATOR = /\s*[·•|]\s*|\s+[—–-]\s+/

const HAS_CJK = /[㐀-鿿豈-﫿]/

/** A concept line from a code explanation: `term · 中文 · why it matters here`. */
export function parseConcept(line: string): { term: string; detail: string } | null {
  const trimmed = line.trim().replace(/^[-*•]\s*/, '')
  if (!trimmed) return null
  const parts = trimmed.split(SEPARATOR).map((p) => p.trim()).filter(Boolean)
  const term = parts[0]?.replace(/^`|`$/g, '')
  if (!term) return null
  return { term, detail: parts.slice(1).join('，') }
}

export function parseNotable(line: string): NotableTerm | null {
  const trimmed = line.trim().replace(/^[-*•]\s*/, '')
  if (!trimmed) return null

  const parts = trimmed.split(SEPARATOR).filter((p) => p.trim())
  const term = parts[0]?.trim()
  if (!term) return null

  const rest = parts.slice(1).map((p) => p.trim())

  // The IPA is whichever part is slash-wrapped, wherever it landed.
  const ipa = rest.find((p) => /^\/.*\/$/.test(p))
  const remaining = rest.filter((p) => p !== ipa)

  // Distinguish the Chinese gloss from the English example by script rather than by
  // position: models reorder these, but they never write the gloss in English.
  const gloss = remaining.find((p) => HAS_CJK.test(p)) ?? remaining[0]
  const example = remaining.find((p) => p !== gloss && !HAS_CJK.test(p))

  return { term, ipa, gloss: gloss || undefined, example: example || undefined }
}
