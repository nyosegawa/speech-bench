import { describe, expect, it } from 'vitest'
import { parseAnnotated } from '../src/spellings/notation.ts'

const errorsOf = (line: string): string[] => parseAnnotated(line).errors

describe('parseAnnotated', () => {
  it('gives back the reference with the marks taken away', () => {
    const { reference, errors } = parseAnnotated('［えーと／えっと／］、明日《あした》は［九《く》時《じ》／9時］に｜Zoom《ズーム》で。')
    expect(errors).toEqual([])
    expect(reference).toBe('えーと、明日は九時にZoomで。')
  })

  it('takes the run of kanji just before a reading as its base, and everything after ｜ for any other base', () => {
    const { segments } = parseAnnotated('今日《きょう》の｜Zoom《ズーム》と｜10《じゅう》月《がつ》')
    expect(segments.flatMap((segment) => segment.pieces.map((piece) => [piece.text, piece.readings]))).toEqual([
      ['今日', ['きょう']], ['の', []], ['Zoom', ['ズーム']], ['と', []], ['10', ['じゅう']], ['月', ['がつ']]
    ])
  })

  it('reads the other spellings of a bracketed stretch, and an empty one as leaving it out', () => {
    const [filler, , hour] = parseAnnotated('［えーと／えっと／］、［九《く》時《じ》／9時／九じ］').segments
    expect(filler).toMatchObject({ bracketed: true, spellings: ['えっと'], optional: true })
    expect(hour).toMatchObject({ bracketed: true, spellings: ['9時', '九じ'], optional: false, start: 4, end: 6 })
  })

  it('takes two readings of one base', () => {
    expect(parseAnnotated('一日《ついたち／いちにち》').segments[0]!.pieces[0]!.readings).toEqual(['ついたち', 'いちにち'])
  })

  it('needs a reading for every scored character that is not kana, a mark read between numerals included', () => {
    expect(errorsOf('明日は')).toHaveLength(2)
    expect(errorsOf('｜Zoom《ズーム》とAI')).toHaveLength(2)
    expect(errorsOf('1～3')).toHaveLength(3)
    expect(errorsOf('｜1《いち》｜～《から》｜3《さん》')).toEqual([])
    expect(errorsOf('はい、そうですね。ー')).toEqual([])
  })

  it('refuses a reading that is not kana, and a reading for a base in kana', () => {
    expect(errorsOf('今日《kyou》')).not.toEqual([])
    expect(errorsOf('はい《はい》')).not.toEqual([])
    expect(errorsOf('Zoom《ズーム》')).not.toEqual([])
  })

  it('refuses another spelling that is scored as the stretch as written or as its reading already', () => {
    expect(errorsOf('［｜AWS《エーダブリューエス》／A W S］')).not.toEqual([])
    expect(errorsOf('［今日《きょう》／きょう］')).not.toEqual([])
    expect(errorsOf('［今日《きょう》／キョウ］')).not.toEqual([])
    expect(errorsOf('［今日《きょう》／今日。］')).not.toEqual([])
  })

  it('refuses nested brackets, a bracket without another spelling, a reading inside another spelling and unclosed marks', () => {
    expect(errorsOf('［［明日《あした》／あす］／きょう］')).not.toEqual([])
    expect(errorsOf('［明日《あした》］')).not.toEqual([])
    expect(errorsOf('［明日《あした》／明《あ》日］')).not.toEqual([])
    expect(errorsOf('明日《あした')).not.toEqual([])
    expect(errorsOf('［明日《あした》／あす')).not.toEqual([])
    expect(errorsOf('｜明日')).not.toEqual([])
  })
})
