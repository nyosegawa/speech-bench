import { describe, expect, it } from 'vitest'
import { countHeardErrors, heardAsSaid, readJapaneseNumerals, readLongVowels } from '../src/measure/heard.ts'

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

describe('countHeardErrors', () => {
  it('takes a number in kanji and in digits, and a long vowel mark and its vowel, as the same in synthesized speech', () => {
    expect(countHeardErrors('今は1ドルが148円32銭です。', '今は一ドルが百四十八円三十二銭です。', 'ja-JP').errors).toBe(0)
    expect(countHeardErrors('あー。', 'ああ。', 'ja-JP')).toEqual({ errors: 0, referenceLength: 2 })
  })

  it('counts a synthesized sentence that runs on as all wrong, and no more', () => {
    expect(countHeardErrors('あー。', 'あ'.repeat(500), 'ja-JP')).toEqual({ errors: 2, referenceLength: 2 })
    expect(countHeardErrors('はい。', 'はい、うん。', 'ja-JP')).toEqual({ errors: 2, referenceLength: 2 })
  })
})

describe('heardAsSaid', () => {
  it('passes a sentence heard as written in another spelling', () => {
    expect(heardAsSaid('はい。', 'ハイ', 'ja-JP')).toBe(true)
    expect(heardAsSaid('あー。', 'あぁ。', 'ja-JP')).toBe(true)
    expect(heardAsSaid('あー。', 'ああ', 'ja-JP')).toBe(true)
    expect(heardAsSaid('うんうん。', 'うん、うん。', 'ja-JP')).toBe(true)
  })

  it('fails a sentence heard shorter, longer or with words more', () => {
    expect(heardAsSaid('あー。', 'あ。', 'ja-JP')).toBe(false)
    expect(heardAsSaid('あー。', 'あ'.repeat(40), 'ja-JP')).toBe(false)
    expect(heardAsSaid('うんうん。', 'うん。', 'ja-JP')).toBe(false)
    expect(heardAsSaid('はい。', 'はい、そうよ。', 'ja-JP')).toBe(false)
  })

  it('compares other languages as scoring normalizes them', () => {
    expect(heardAsSaid('Yes.', 'yes', 'en-US')).toBe(true)
    expect(heardAsSaid('Yes.', 'yes yes', 'en-US')).toBe(false)
  })
})
