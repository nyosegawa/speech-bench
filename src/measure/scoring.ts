import { languageOf, scoredByCharacter } from '../core/language.ts'

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

const VOWEL_ROWS = ['あぁかがさざただなはばぱまやゃらわゎ', 'いぃきぎしじちぢにひびぴみりゐ', 'うぅくぐすずつづぬふぶぷむゆゅるゔ', 'えぇけげせぜてでねへべぺめれゑ', 'おぉこごそぞとどのほぼぽもよょろを']
const HIRAGANA_VOWELS = 'あいうえお'
const KATAKANA_VOWELS = 'アイウエオ'
/** Katakana from ァ to ヶ stand 0x60 code points above the hiragana of the same sound. */
const KATAKANA_OFFSET = 0x60

/**
 * Japanese text with each long vowel mark written as the vowel it lengthens, in the script of the kana before
 * it: あー becomes ああ and コーヒー コオヒイ. Recognizers write a drawn-out あ either way, and synthesized speech
 * is heard as ああ as often as あー. A mark after a kana without a vowel of its own, such as ん, stays.
 */
export function readLongVowels(text: string): string {
  let read = ''
  for (const character of text) {
    const before = read.at(-1)
    if (character !== 'ー' || before === undefined) {
      read += character
      continue
    }
    const code = before.codePointAt(0)!
    const katakana = code >= 0x30a1 && code <= 0x30f6
    const hiragana = katakana ? String.fromCodePoint(code - KATAKANA_OFFSET) : before
    const row = VOWEL_ROWS.findIndex((kana) => kana.includes(hiragana))
    read += row < 0 ? character : (katakana ? KATAKANA_VOWELS : HIRAGANA_VOWELS)[row]
  }
  return read
}

/**
 * The text as it is compared: NFKC, lower case, and without punctuation, symbols and spaces for character
 * scoring, or with runs of spaces collapsed for word scoring. Punctuation is left out because models
 * differ in how they punctuate, which is not a recognition error; the Neosophie benchmark normalizes the
 * same way. Japanese numbers are compared in Arabic digits, since a reader takes 一ドル and 1ドル alike, and
 * long vowel marks as the vowels they lengthen.
 */
export function normalizeForScoring(text: string, locale: string): string {
  const byCharacter = scoredByCharacter(locale)
  const folded = text.normalize('NFKC').toLowerCase()
  const numbers = languageOf(locale) === 'ja' ? readLongVowels(readJapaneseNumerals(folded)) : folded
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

/** Katakana from ァ to ヶ, which spell the same sounds as hiragana. */
const toHiragana = (text: string): string => text.replace(/[\u30a1-\u30f6]/gu, (kana) => String.fromCodePoint(kana.codePointAt(0)! - KATAKANA_OFFSET))
const SMALL_VOWELS: Readonly<Record<string, string>> = { ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お' }

/**
 * Whether the recognizer heard a sentence as it was written, apart from how it spells it: besides what scoring
 * leaves out, Japanese is compared with katakana as hiragana and small vowels as full-size ones, so that はい,
 * ハイ, あー, ああ and あぁ pass. A length or a count heard otherwise, あ for あー or うん for うんうん, and any word
 * more or less do not: a vowel drawn out for seconds is heard as one あ or a long run of them.
 */
export function heardAsSaid(text: string, transcript: string, locale: string): boolean {
  const spelled = (written: string): string => {
    const normalized = normalizeForScoring(written, locale)
    return languageOf(locale) === 'ja' ? toHiragana(normalized).replace(/[ぁぃぅぇぉ]/gu, (vowel) => SMALL_VOWELS[vowel]!) : normalized
  }
  return spelled(text) === spelled(transcript)
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

/**
 * The errors the recognizer made in hearing one synthesized sentence, at most as many as the sentence has. A
 * take that runs on is broken whatever its length, and counted in full one take decided a voice's rate: on
 * 2026-10-01 a 3.8 s あー。 heard as あ 511 times made 46.6% of a reference voice's 1,206 characters, against
 * 4.2% without it.
 */
export function countHeardErrors(text: string, transcript: string, locale: string): ErrorCount {
  const count = countErrors(text, transcript, locale)
  return { errors: Math.min(count.errors, count.referenceLength), referenceLength: count.referenceLength }
}
