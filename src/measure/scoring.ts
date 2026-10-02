import { scoredByCharacter } from '../core/language.ts'
import { FORM_IN_USE } from './kanji-forms.ts'

/** One character a text is compared in, with the code-point range of the written text it comes from. */
export interface Unit {
  text: string
  start: number
  end: number
}

const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' })
/** Marks read aloud wherever they stand, after NFKC. */
const READ_MARKS = new Set(['%', '‰', '°', '¥', '$', '€', '£', '&'])
/** Marks read aloud between two numerals: 6.5, 12:00, 1~3, 6-6, 1/2. */
const BETWEEN_NUMERALS = new Set(['.', ':', '~', '〜', '-', '−', '/'])
const NUMERAL = /^[\p{Nd}〇一二三四五六七八九十百千万億兆]$/u

/**
 * The characters a text written without spaces between words is compared in, each with the range of the grapheme it
 * comes from: NFKC, lower case and the form of a kanji in use today (髓 as 髄), without spaces, apostrophes and the
 * punctuation and symbols that are not read aloud, since models differ in how they punctuate, which is not an error
 * of hearing. Nothing that can change a word is folded: kanji numerals and digits, and a long vowel mark and its
 * vowel, stay apart, and the accepted spellings of a sentence let them pass where it allows. A mark that is read
 * stays, so that 27% and 27 differ: %, currency signs, ° and & anywhere, and . : ~ - / between two numerals.
 */
export function characterUnits(text: string): Unit[] {
  const clusters: Array<{ start: number; end: number; folded: string }> = []
  let at = 0
  for (const { segment } of graphemes.segment(text)) {
    const length = [...segment].length
    clusters.push({ start: at, end: at + length, folded: segment.normalize('NFKC').toLowerCase() })
    at += length
  }
  const numeral = (index: number): boolean => NUMERAL.test(clusters[index]?.folded ?? '')
  return clusters.flatMap((cluster, index) => [...cluster.folded].flatMap((character) => {
    if (/[\p{Z}\s'’]/u.test(character)) return []
    const read = READ_MARKS.has(character) || (BETWEEN_NUMERALS.has(character) && numeral(index - 1) && numeral(index + 1))
    if (/[\p{P}\p{S}]/u.test(character) && !read) return []
    return [{ text: FORM_IN_USE.get(character) ?? character, start: cluster.start, end: cluster.end }]
  }))
}

/** The Levenshtein distance between two sequences. */
export function editDistance<T>(reference: readonly T[], hypothesis: readonly T[]): number {
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index)
  for (let row = 1; row <= reference.length; row++) {
    const current = [row]
    for (let column = 1; column <= hypothesis.length; column++) {
      const substitution = (previous[column - 1] ?? 0) + (reference[row - 1] === hypothesis[column - 1] ? 0 : 1)
      current.push(Math.min((previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1, substitution))
    }
    previous = current
  }
  return previous[hypothesis.length] ?? 0
}

/** The errors of one transcription and the length of its reference, so that rates can be summed over a corpus. */
export interface ErrorCount {
  errors: number
  referenceLength: number
}

/**
 * The words a text of a language scored by word is compared in: NFKC, lower case, and punctuation and symbols as
 * spaces. An apostrophe joins the parts of a word (don't, l'homme), so it is removed rather than turned into a space.
 */
export function wordUnits(text: string): string[] {
  const words = text.normalize('NFKC').toLowerCase().replace(/['’]/gu, '').replace(/[\p{P}\p{S}]/gu, ' ').replace(/[\p{Z}\s]+/gu, ' ').trim()
  return words === '' ? [] : words.split(' ')
}

const units = (text: string, locale: string): string[] => (scoredByCharacter(locale) ? characterUnits(text).map((unit) => unit.text) : wordUnits(text))

/** Characters for Japanese, Korean and Chinese, words for the other languages. */
export function countErrors(reference: string, hypothesis: string, locale: string): ErrorCount {
  const expected = units(reference, locale)
  return { errors: editDistance(expected, units(hypothesis, locale)), referenceLength: expected.length }
}

/** One step of an alignment: a unit of each side, or of one side where the other has none. */
export interface Aligned {
  reference: string | null
  hypothesis: string | null
}

/**
 * The units of a reference and a transcription, as they are scored, lined up by the fewest edits, so that a page
 * can show where they differ. The steps that are not a unit matched with itself are the errors countErrors counts.
 */
export function align(reference: string, hypothesis: string, locale: string): Aligned[] {
  const expected = units(reference, locale)
  const heard = units(hypothesis, locale)
  const cost = Array.from({ length: expected.length + 1 }, (_, row) => Array.from({ length: heard.length + 1 }, (_, column) => (row === 0 ? column : column === 0 ? row : 0)))
  for (let row = 1; row <= expected.length; row++) {
    for (let column = 1; column <= heard.length; column++) {
      const substitution = cost[row - 1]![column - 1]! + (expected[row - 1] === heard[column - 1] ? 0 : 1)
      cost[row]![column] = Math.min(cost[row - 1]![column]! + 1, cost[row]![column - 1]! + 1, substitution)
    }
  }
  const steps: Aligned[] = []
  let row = expected.length
  let column = heard.length
  while (row > 0 || column > 0) {
    const here = cost[row]![column]!
    if (row > 0 && column > 0 && here === cost[row - 1]![column - 1]! + (expected[row - 1] === heard[column - 1] ? 0 : 1)) {
      steps.push({ reference: expected[--row]!, hypothesis: heard[--column]! })
    } else if (row > 0 && here === cost[row - 1]![column]! + 1) {
      steps.push({ reference: expected[--row]!, hypothesis: null })
    } else {
      steps.push({ reference: null, hypothesis: heard[--column]! })
    }
  }
  return steps.reverse()
}
