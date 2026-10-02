/**
 * Which pronunciation the popup is allowed to show, and whether it is attested.
 *
 * Where the bundled wordlist has the word, it is the only authority. Where it has
 * nothing — which is most derived vocabulary — the model's reading is shown instead
 * and labelled as unattested, because a blank taught the reader nothing.
 */
import dictionaryText from '../../resources/pronunciation/en_US.txt?raw'
import type {
  Explanation,
  ExplainRequest,
  PronunciationAnchor,
  PronunciationCandidate
} from '../shared/types.js'
import { parseNotable } from './notable.js'
import { ipaFromDefinition } from './noad.js'
import { PRONUNCIATION_USAGE } from './pronunciation-usage.js'

/**
 * A second attested source, supplied by the platform when it has one.
 *
 * macOS ships the New Oxford American Dictionary, which has the derived vocabulary
 * CMU's wordlist misses. Injected rather than imported so this module stays pure and
 * testable, and so the renderer never pulls a native binding into its bundle.
 */
type DefinitionLookup = (word: string) => string | null

let systemDictionary: DefinitionLookup | null = null

export function setSystemDictionary(lookup: DefinitionLookup | null): void {
  systemDictionary = lookup
}

/** The system dictionary's IPA for a word, if the platform has one and knows it. */
export function systemPronunciation(term: string): string | undefined {
  if (!systemDictionary) return undefined
  const word = headword(term)
  try {
    return ipaFromDefinition(word, systemDictionary(word))
  } catch {
    // A dictionary that misbehaves must never take a lookup down with it.
    return undefined
  }
}

// Version the data AND the selection rules. Older model-generated IPA must not be
// mistaken for a contextual choice made from the supplied dictionary candidates.
export const PRONUNCIATION_CACHE_VERSION = 'cmu-ipa-44accfb5-noad-v3'

let dictionary: Map<string, readonly string[]> | undefined

function entries(): Map<string, readonly string[]> {
  if (!dictionary) {
    dictionary = new Map()
    for (const line of dictionaryText.split('\n')) {
      const [word, value] = line.trim().split('\t')
      if (!word || !value) continue
      const variants = [...new Set(value.split(', ').filter((ipa) => /^\/[^/]+\/$/.test(ipa)))]
      if (variants.length) dictionary.set(word, variants)
    }
  }
  return dictionary
}

function headword(term: string): string {
  const normalized = term.trim().toLowerCase().replace(/[‘’]/g, "'")
  if (entries().has(normalized)) return normalized
  // Selection punctuation and Markdown quotes are not part of the word. Preserve
  // internal apostrophes/hyphens and never turn a phrase into an unrelated headword.
  return normalized.replace(/^["'`“”([{]+|["'`“”)\]},.!?:;]+$/g, '')
}

export function lookupPronunciations(term: string): readonly string[] {
  return entries().get(headword(term)) ?? []
}

/**
 * The longest shorter word the dictionary does know, as something to work from.
 *
 * Asked cold for "reproducible", qwen-flash answered /rɪˈproʊdəˌbəl/ — it had dropped
 * a whole syllable. Shown "reproduce /ˌɹipɹəˈdus/" first, it answered
 * /ˌɹipɹəˈdusəbəl/, which is right. Measured over six words the wordlist lacks, the
 * anchor took it from none correct to half, so it is worth supplying — and half is
 * also why `unverifiedPronunciations` defaults to off.
 *
 * Deliberately not composed here: appending the suffix's own phonemes matches the
 * dictionary only 46–74% of the time on words it does have, because -able moves the
 * stress in "comparable" and "preferable" and leaves it alone in "deployable". A model
 * at least knows which words those are.
 */
const MIN_STEM = 4

export function stemAnchor(term: string): PronunciationAnchor | undefined {
  const word = headword(term)
  if (lookupPronunciations(word).length || systemPronunciation(word)) return undefined
  for (let end = word.length - 1; end >= MIN_STEM; end--) {
    // The silent -e that "reproduce" keeps and "reproducible" drops.
    for (const candidate of [word.slice(0, end), `${word.slice(0, end)}e`]) {
      const [ipa] = lookupPronunciations(candidate)
      if (ipa) return { term: candidate, ipa }
    }
  }
  return undefined
}

/** Give the explanation model a bounded choice, not a request to invent IPA. */
export function withPronunciationHints(req: ExplainRequest): ExplainRequest {
  if (req.mode === 'code') return req
  const hints: Record<string, readonly PronunciationCandidate[]> = Object.create(null)
  const terms = req.mode === 'word'
    ? [req.text]
    : [...new Set(req.text.match(/[a-z]+(?:['’-][a-z]+)*/gi) ?? [])]
  for (const term of terms) {
    const variants = lookupPronunciations(term)
    // Single pronunciations can be filled locally; only ambiguous passage words
    // need extra prompt tokens. Cap hints even when the selection is a whole page.
    if (variants.length > (req.mode === 'word' ? 0 : 1)) {
      const word = headword(term)
      hints[word] = variants.map((ipa) => ({ ipa, usage: PRONUNCIATION_USAGE[word]?.[ipa] }))
    }
    if (Object.keys(hints).length >= 40) break
  }
  // Only for a single word. In a passage the hard words are the model's own choice,
  // and anchoring each one would cost more prompt than the answer is worth.
  const anchor = req.mode === 'word' ? stemAnchor(req.text) : undefined
  return { ...req, pronunciationHints: hints, ...(anchor ? { pronunciationAnchor: anchor } : {}) }
}

/** A well-formed broad transcription, and not the model's way of saying "I don't know". */
const IPA_SHAPE = /^\/[^/\s][^/]*\/$/

export function looksLikeIpa(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? ''
  if (!trimmed || /^[(（]?none[)）]?$/i.test(trimmed)) return false
  return IPA_SHAPE.test(trimmed)
}

/**
 * The pronunciation to show, and whether the dictionary vouches for it.
 *
 * Where the dictionary has entries it is the only authority: a model's near-match
 * must never be allowed to shift a vowel or move the stress, which is what listing
 * every variant guards against. Where it has no entry at all there is nothing to
 * contradict, and a labelled reading from the model beats a blank — the wordlist
 * misses most derived vocabulary ("reproducible", "maintainable", "idempotent"), and
 * deriving one from its stem is not safe either, since -able moves the stress in
 * "comparable" and "preferable" but not in "deployable".
 */
function resolveIpa(
  term: string,
  proposed: string | undefined,
  canChoose: boolean,
  allowUnverified: boolean
): { ipa: string; verified: boolean } | undefined {
  const variants = lookupPronunciations(term)
  if (!variants.length) {
    // The platform's own dictionary is attested too, and for these words it is the
    // better source: CMU's wordlist is from the 1990s and has none of them.
    const fromSystem = systemPronunciation(term)
    if (fromSystem) return { ipa: fromSystem, verified: true }
    if (!allowUnverified || !looksLikeIpa(proposed)) return undefined
    return { ipa: proposed!.trim(), verified: false }
  }
  // An exact candidate may be selected from context, but never let a model's
  // near-match change vowels or stress. Unresolved choices remain explicit.
  if (canChoose && proposed && variants.includes(proposed.trim())) {
    return { ipa: proposed.trim(), verified: true }
  }
  return { ipa: variants.join(' or '), verified: true }
}

/** Apply to every streamed snapshot, final answer, and cache hit before display. */
export function withDictionaryPronunciations(
  req: ExplainRequest,
  explanation: Explanation,
  complete = true,
  allowUnverified = false
): Explanation {
  const result = { ...explanation }
  delete result.ipa
  delete result.unverifiedIpa
  const isCode = req.mode === 'code' || explanation.isCode
  const unverified: string[] = []

  if (req.mode === 'word' && !isCode) {
    const hasContext = !!req.context?.trim() && req.context.trim() !== req.text.trim()
    const supplied = Object.hasOwn(req.pronunciationHints ?? {}, headword(req.text))
    const resolved = resolveIpa(req.text, explanation.ipa, complete && hasContext && supplied, allowUnverified)
    if (resolved) {
      result.ipa = resolved.ipa
      if (!resolved.verified) unverified.push(req.text)
    }
  }

  if (explanation.notable) {
    result.notable = explanation.notable.flatMap((line) => {
      const term = parseNotable(line)
      if (!term) return []
      const supplied = Object.hasOwn(req.pronunciationHints ?? {}, headword(term.term))
      const resolved = isCode ? undefined
        : resolveIpa(term.term, term.ipa, complete && req.mode === 'passage' && supplied, allowUnverified)
      if (resolved && !resolved.verified) unverified.push(term.term)
      return [[term.term, resolved?.ipa, term.gloss, term.example].filter(Boolean).join(' · ')]
    })
  }

  if (unverified.length) result.unverifiedIpa = unverified
  return result
}
