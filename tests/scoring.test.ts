import { describe, expect, it } from 'vitest'
import { align, countErrors, editDistance } from '../src/measure/scoring.ts'

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

  it('counts a Japanese number in kanji against one in digits, and a long vowel mark against its vowel', () => {
    expect(countErrors('今は1ドルです。', '今は一ドルです。', 'ja-JP').errors).toBe(1)
    expect(countErrors('暗証番号は8264です。', '暗証番号は八二六四です。', 'ja-JP').errors).toBe(4)
    expect(countErrors('あー。', 'ああ。', 'ja-JP')).toEqual({ errors: 1, referenceLength: 2 })
  })

  it('keeps a mark read aloud, and compares an old kanji form as the form in use', () => {
    expect(countErrors('残りは27%です', '残りは27です', 'ja-JP').errors).toBe(1)
    expect(countErrors('脳、脊髄、視神経', '脳脊髓視神経', 'ja-JP').errors).toBe(0)
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

describe('align', () => {
  const pairs: Array<[string, string, string]> = [
    ['こんにちは、田中さん。', 'こんばんは田中さん', 'ja-JP'],
    ['明日の三時に会議です。', 'あしたの3時、会議ですね', 'ja-JP'],
    ['The meeting is at three.', 'the meeting at three o clock', 'en-US'],
    ['', 'えーと', 'ja-JP']
  ]

  it('makes as many edits as the errors counted, and keeps both texts in order', () => {
    for (const [reference, hypothesis, locale] of pairs) {
      const steps = align(reference, hypothesis, locale)
      expect(steps.filter((step) => step.reference !== step.hypothesis).length).toBe(countErrors(reference, hypothesis, locale).errors)
      const side = (pick: 'reference' | 'hypothesis'): string => steps.flatMap((step) => step[pick] ?? []).join(locale === 'en-US' ? ' ' : '')
      expect(side('reference')).toBe(align(reference, reference, locale).map((step) => step.reference).join(locale === 'en-US' ? ' ' : ''))
      expect(side('hypothesis')).toBe(align(hypothesis, hypothesis, locale).map((step) => step.reference).join(locale === 'en-US' ? ' ' : ''))
    }
  })

  it('lines up the characters that differ against each other', () => {
    expect(align('こんにちは', 'こんばんは', 'ja-JP').filter((step) => step.reference !== step.hypothesis)).toEqual([
      { reference: 'に', hypothesis: 'ば' },
      { reference: 'ち', hypothesis: 'ん' }
    ])
  })
})
