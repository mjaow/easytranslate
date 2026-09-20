/**
 * Parsing one "hard word" line out of a passage explanation.
 *
 * The model is asked for `term · /IPA/ · Chinese meaning`, but models drift on
 * separators and sometimes omit the IPA — so this stays tolerant rather than
 * dropping a line it doesn't recognise. A term with no gloss is still useful.
 */
export interface NotableTerm {
  term: string
  ipa?: string
  gloss?: string
}

/** Separators models actually produce, in place of the requested middle dot. */
const SEPARATOR = /\s*[·•|]\s*|\s+[—–-]\s+/

export function parseNotable(line: string): NotableTerm | null {
  const trimmed = line.trim().replace(/^[-*•]\s*/, '')
  if (!trimmed) return null

  const parts = trimmed.split(SEPARATOR).filter((p) => p.trim())
  if (parts.length === 0) return null

  const term = parts[0].trim()
  if (!term) return null

  // The IPA is whichever part is slash-wrapped, wherever it landed.
  const ipaIndex = parts.findIndex((p, i) => i > 0 && /^\/.*\/$/.test(p.trim()))
  const ipa = ipaIndex > 0 ? parts[ipaIndex].trim() : undefined
  const gloss = parts
    .slice(1)
    .filter((_, i) => i + 1 !== ipaIndex)
    .join(' ')
    .trim()

  return { term, ipa, gloss: gloss || undefined }
}
