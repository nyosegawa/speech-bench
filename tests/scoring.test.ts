import { describe, expect, it } from 'vitest'
import { countErrors, countHeardErrors, editDistance, readJapaneseNumerals, readLongVowels } from '../src/scoring.ts'

describe('countErrors', () => {
  it('ignores punctuation, spaces and full-width forms in Japanese', () => {
    expect(countErrors('技術決定論の、解釈は「２つ」です。', '技術決定論の解釈は 2つです', 'ja-JP')).toEqual({ errors: 0, referenceLength: 13 })
  })

  it('counts a misheard Japanese word by character', () => {
    expect(countErrors('いいえ', 'いや', 'ja-JP')).toEqual({ errors: 2, referenceLength: 3 })
  })

  it('counts words for English and treats an apostrophe as part of the word', () => {
    expect(countErrors("Don't stop, believing!", 'dont stop believing', 'en-US')).toEqual({ errors: 0, referenceLength: 3 })
    expect(countErrors('the cat sat', 'the cat sat down', 'en-US')).toEqual({ errors: 1, referenceLength: 3 })
  })

  it('takes a Japanese number written in kanji and in digits as the same', () => {
    expect(countErrors('今は1ドルが148円32銭です。', '今は一ドルが百四十八円三十二銭です。', 'ja-JP').errors).toBe(0)
    expect(countErrors('暗証番号は8264です。', '暗証番号は八二六四です。', 'ja-JP').errors).toBe(0)
    expect(countErrors('暗証番号は8264です。', '暗証番号は八二五六四です。', 'ja-JP').errors).toBe(1)
  })

  it('counts every reference unit as an error when nothing was transcribed', () => {
    expect(countErrors('bonjour à tous', '', 'fr-FR')).toEqual({ errors: 3, referenceLength: 3 })
  })
})

describe('editDistance', () => {
  it('counts substitutions, insertions and deletions', () => {
    expect(editDistance([...'kitten'], [...'sitting'])).toBe(3)
    expect(editDistance([], [...'abc'])).toBe(3)
  })
})

describe('readJapaneseNumerals', () => {
  it('reads positional and digit-by-digit kanji numbers', () => {
    expect(readJapaneseNumerals('百四十八円三十二銭')).toBe('148円32銭')
    expect(readJapaneseNumerals('二十四度、十分、千円')).toBe('24度、10分、1000円')
    expect(readJapaneseNumerals('八二六四と〇')).toBe('8264と0')
  })

  it('keeps the large units as written, the way numbers above ten thousand are usually written', () => {
    expect(readJapaneseNumerals('三百五十万円')).toBe('350万円')
    expect(readJapaneseNumerals('一万二千三百四十五')).toBe('1万2345')
    expect(readJapaneseNumerals('350万円')).toBe('350万円')
  })
})

describe('readLongVowels', () => {
  it('writes a long vowel mark as the vowel of the kana before it, in that kana\'s script', () => {
    expect(readLongVowels('あー')).toBe('ああ')
    expect(readLongVowels('コーヒー')).toBe('コオヒイ')
    expect(readLongVowels('きゃーー')).toBe('きゃああ')
    expect(readLongVowels('ゲーム')).toBe('ゲエム')
  })

  it('keeps a mark after a kana without a vowel of its own, or at the start', () => {
    expect(readLongVowels('んー')).toBe('んー')
    expect(readLongVowels('ーあ')).toBe('ーあ')
  })
})

describe('long vowels in Japanese scoring', () => {
  it('takes a drawn-out vowel written with the mark and with the vowel as the same', () => {
    expect(countErrors('あー。', 'ああ。', 'ja-JP')).toEqual({ errors: 0, referenceLength: 2 })
  })
})

describe('countHeardErrors', () => {
  it('counts a synthesized sentence that runs on as all wrong, and no more', () => {
    expect(countHeardErrors('あー。', 'あ'.repeat(500), 'ja-JP')).toEqual({ errors: 2, referenceLength: 2 })
    expect(countHeardErrors('はい。', 'はい、うん。', 'ja-JP')).toEqual({ errors: 2, referenceLength: 2 })
  })
})
