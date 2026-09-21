/**
 * Deciding whether OCR output is worth explaining.
 *
 * A misread produces a confident wrong answer rather than an error: the model is
 * handed "Fæe aEgvnent >" and dutifully explains "event". That is worse than saying
 * nothing, because it looks like a real answer. This catches the obvious garbage so
 * the app can admit it could not read the area.
 *
 * Deliberately conservative — a false "unreadable" hides text the user could have
 * used, which is the worse failure of the two. Several independent signals must
 * agree before anything is rejected.
 */

/** Letter runs, Latin only — CJK is judged separately. */
const LATIN_WORD = /[A-Za-zÀ-ɏ]+/g

/** Mid-word capitals after a lowercase letter: a classic OCR signature. */
const ODD_CAPS = /[a-z][A-Z]/

/** Accented Latin in what should be English text — æ, ø and friends. */
const EXOTIC_LATIN = /[À-ɏ]/

const VOWELS = /[aeiouyAEIOUY]/

export interface Readability {
  readable: boolean
  /** Fraction of Latin words that look like real words. 1 when there are none. */
  score: number
}

export function assessReadability(text: string): Readability {
  const trimmed = text.trim()
  if (!trimmed) return { readable: false, score: 0 }

  // CJK needs none of this: it has no vowels or capitalisation to reason about, and
  // the Chinese recognizer does not produce this kind of garbage.
  if (/[㐀-鿿]/.test(trimmed)) return { readable: true, score: 1 }

  const words = trimmed.match(LATIN_WORD) ?? []
  if (words.length === 0) return { readable: false, score: 0 }

  // A capital in the middle of a word is the strongest signal available: English does
  // not do it, but OCR produces it constantly. Accented letters are weaker evidence,
  // since "café" and "naïve" are real words.
  const hasOddCaps = words.some((w) => ODD_CAPS.test(w))
  const exoticRatio = words.filter((w) => EXOTIC_LATIN.test(w)).length / words.length

  // Short reads carry too little signal for ratios, so judge them on the strong
  // signals alone — otherwise "Hugging Face" would be rejected alongside the garbage.
  if (words.length < 3) {
    const readable = !hasOddCaps && exoticRatio <= 0.5
    return { readable, score: readable ? 1 : 0 }
  }

  let plausible = 0
  for (const word of words) {
    if (word.length <= 2) {
      plausible++ // "a", "I", "of" — too short to be telling either way
      continue
    }
    const suspicious =
      ODD_CAPS.test(word) || EXOTIC_LATIN.test(word) || !VOWELS.test(word)
    if (!suspicious) plausible++
  }

  const score = plausible / words.length
  // Two in five words visibly mangled is well past anything real text produces.
  return { readable: score >= 0.6, score }
}
