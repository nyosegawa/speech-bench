import { describe, expect, it } from 'vitest'
import { alignAccepted, countAcceptedErrors } from '../src/measure/accepted.ts'
import { characterUnits, editDistance } from '../src/measure/scoring.ts'
import { parseAnnotated } from '../src/spellings/notation.ts'

const errors = (line: string, hypothesis: string): number => {
  const { reference, segments, errors: problems } = parseAnnotated(line)
  if (problems.length > 0) throw new Error(problems.join('; '))
  return countAcceptedErrors(reference, segments, hypothesis).errors
}

describe('countAcceptedErrors', () => {
  it('accepts any part in the kana of its reading, in hiragana or katakana', () => {
    expect(errors('今日《きょう》は猫《ねこ》がいる', 'きょうはネコがいる')).toBe(0)
    expect(errors('｜Slack《スラック》で', 'すらっくで')).toBe(0)
  })

  it('accepts a word written partly in kana where its reading splits', () => {
    expect(errors('子《こ》供《ども》', '子ども')).toBe(0)
    expect(errors('子《こ》供《ども》', 'こ供')).toBe(0)
  })

  it('accepts a bracketed stretch as one of its spellings, and an optional one left out', () => {
    const line = '［えーと／えっと／］、明日《あした》は［九《く》時《じ》／9時］'
    expect(errors(line, '明日は9時')).toBe(0)
    expect(errors(line, 'えっと、あしたは9時')).toBe(0)
    expect(errors(line, 'えーとあしたはくじ')).toBe(0)
  })

  it('keeps another kanji of the same sound, and another spoken form, as errors', () => {
    expect(errors('直《なお》る', '治る')).toBe(1)
    expect(errors('思《おも》っている', '思ってる')).toBe(1)
  })

  it('counts the length of the reference as written, whichever way through is closest', () => {
    const { reference, segments } = parseAnnotated('［｜27《にじゅうなな》／二十七］［パーセント／%］')
    expect(countAcceptedErrors(reference, segments, '27%')).toEqual({ errors: 0, referenceLength: 7 })
    expect(countAcceptedErrors(reference, segments, '27')).toEqual({ errors: 1, referenceLength: 7 })
  })

  it('never counts more errors than the reference as written does', () => {
    const cases: Array<[string, string]> = [
      ['今日《きょう》は猫《ねこ》がいる', '今日は犬がいる'],
      ['［えーと／えっと／］、明日《あした》は［九《く》時《じ》／9時］', 'えーと明日は九時半'],
      ['［｜350《さんびゃくごじゅう》万《まん》／三百五十万／3500000］円《えん》', '三百五十円'],
      ['子《こ》供《ども》の｜USB《ユーエスビー》', 'こどものゆーえすびー'],
      ['［ありがとございます／ありがとうございます］', '']
    ]
    for (const [line, hypothesis] of cases) {
      const reference = parseAnnotated(line).reference
      const asWritten = editDistance(characterUnits(reference).map((unit) => unit.text), characterUnits(hypothesis).map((unit) => unit.text))
      expect(errors(line, hypothesis)).toBeLessThanOrEqual(asWritten)
    }
  })
})

describe('alignAccepted', () => {
  const aligned = (line: string, hypothesis: string) => {
    const { reference, segments } = parseAnnotated(line)
    return alignAccepted(reference, segments, hypothesis)
  }

  it('says which reading or spelling each step was read as, and makes as many wrong steps as errors', () => {
    const cases: Array<[string, string]> = [
      ['明日《あした》は［九《く》時《じ》／9時］', 'あしたは9じ'],
      ['［えーと／えっと／］、明日《あした》は［九《く》時《じ》／9時］', 'えっと明日は九時半'],
      ['子《こ》供《ども》の｜USB《ユーエスビー》', 'こどものゆーえすびー'],
      ['直《なお》る', '治る']
    ]
    for (const [line, hypothesis] of cases) {
      const { steps, errors } = aligned(line, hypothesis)
      expect(steps.filter((step) => !step.right)).toHaveLength(errors)
      expect(steps.flatMap((step) => step.hypothesis ?? []).join('')).toBe(characterUnits(hypothesis).map((unit) => unit.text).join(''))
    }
    const { steps } = aligned('明日《あした》は［九《く》時《じ》／9時］', 'あしたは9時')
    expect(steps.every((step) => step.right)).toBe(true)
    expect(steps[0]!.taken).toEqual({ written: '明日', as: 'あした' })
    expect(steps.at(-1)!.taken).toEqual({ written: '九時', as: '9時' })
  })

  it('takes the reference as written where another way is as close', () => {
    const { steps } = aligned('明日《あした》', '明日')
    expect(steps.some((step) => step.taken)).toBe(false)
  })
})

describe('characterUnits', () => {
  const texts = (text: string): string[] => characterUnits(text).map((unit) => unit.text)

  it('keeps the marks read aloud and drops the punctuation that is not', () => {
    expect(texts('27%')).toEqual(['2', '7', '%'])
    expect(texts('6.5と1～3、12:00')).toEqual(['6', '.', '5', 'と', '1', '~', '3', '1', '2', ':', '0', '0'])
    expect(texts('1,000円。「はい」')).toEqual(['1', '0', '0', '0', '円', 'は', 'い'])
    expect(texts('A & B')).toEqual(['a', '&', 'b'])
  })

  it('folds full-width forms and case, and keeps the range of the written character', () => {
    expect(characterUnits('ＡＩ２つ')).toEqual([
      { text: 'a', start: 0, end: 1 }, { text: 'i', start: 1, end: 2 }, { text: '2', start: 2, end: 3 }, { text: 'つ', start: 3, end: 4 }
    ])
  })
})
