/**
 * Word counting, used to decide whether a selection is a term or a passage.
 *
 * This file once also split passages into clickable word chips. That feature is gone:
 * selecting the text you want is simpler and more direct than picking it out of a
 * grid afterwards.
 */

/**
 * One match per word:
 *  - a single CJK character (they carry meaning individually)
 *  - a Latin word, keeping internal apostrophes and hyphens attached, so "he's" and
 *    "well-known" each count once rather than two or three times
 *  - a number, keeping decimal points and thousands separators attached
 */
const WORD_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{M}]+(?:['’‘-][\p{L}\p{M}]+)*|\p{N}+(?:[.,]\p{N}+)*/gu

/** How many real words a selection contains. Drives word-vs-passage mode detection. */
export function wordCount(text: string): number {
  let n = 0
  WORD_RE.lastIndex = 0
  while (WORD_RE.exec(text) !== null) n++
  return n
}
