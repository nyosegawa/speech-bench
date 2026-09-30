import { languageOf, scoredByCharacter } from './language.ts'

const KANJI_DIGITS: Readonly<Record<string, number>> = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const KANJI_SMALL_UNITS: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1000 }

/** A run of kanji numerals below 10,000 in Arabic digits: 百四十八 is 148, and 八二六四, read digit by digit, 8264. */
function readKanjiSection(run: string): string {
  const characters = [...run]
  if (!characters.some((character) => character in KANJI_SMALL_UNITS)) return characters.map((character) => String(KANJI_DIGITS[character])).join('')
  let total = 0
  let digit = 0
  for (const character of characters) {
    const unit = KANJI_SMALL_UNITS[character]
    if (unit === undefined) {
      digit = KANJI_DIGITS[character] ?? 0
    } else {
      total += (digit || 1) * unit
      digit = 0
    }
  }
  return String(total + digit)
}

/**
 * Japanese text with its kanji numerals in Arabic digits, the large units 万, 億 and 兆 kept as written:
 * 百四十八円 becomes 148円 and 三百五十万円 350万円, as 350万円 is usually written. A reference and a
 * transcription that write the same number the two ways then compare equal; a word such as 一緒 changes
 * the same way on both sides.
 */
export function readJapaneseNumerals(text: string): string {
  return text.replace(/[〇零一二三四五六七八九十百千万億兆]+/gu, (run) =>
    run.split(/([万億兆])/u).map((part) => (part === '' || '万億兆'.includes(part) ? part : readKanjiSection(part))).join(''))
}

/**
 * The text as it is compared: NFKC, lower case, and without punctuation, symbols and spaces for character
 * scoring, or with runs of spaces collapsed for word scoring. Punctuation is left out because models
 * differ in how they punctuate, which is not a recognition error; the Neosophie benchmark normalizes the
 * same way. Japanese numbers are compared in Arabic digits, since a reader takes 一ドル and 1ドル alike.
 */
export function normalizeForScoring(text: string, locale: string): string {
  const byCharacter = scoredByCharacter(locale)
  const folded = text.normalize('NFKC').toLowerCase()
  const numbers = languageOf(locale) === 'ja' ? readJapaneseNumerals(folded) : folded
  // An apostrophe joins the parts of a word (don't, l'homme), so it is removed rather than turned into a space.
  const bare = numbers.replace(/['’]/gu, '').replace(/[\p{P}\p{S}]/gu, byCharacter ? '' : ' ')
  return byCharacter ? bare.replace(/\p{Z}|\s/gu, '') : bare.replace(/[\p{Z}\s]+/gu, ' ').trim()
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

const units = (text: string, locale: string): string[] => {
  const normalized = normalizeForScoring(text, locale)
  if (scoredByCharacter(locale)) return [...normalized]
  return normalized === '' ? [] : normalized.split(' ')
}

/** Characters for Japanese, Korean and Chinese, words for the other languages. */
export function countErrors(reference: string, hypothesis: string, locale: string): ErrorCount {
  const expected = units(reference, locale)
  return { errors: editDistance(expected, units(hypothesis, locale)), referenceLength: expected.length }
}
