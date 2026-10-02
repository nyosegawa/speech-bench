import { characterUnits } from '../measure/scoring.ts'

/** A run of the reference as written, with the readings in kana it may be written in instead. */
export interface Piece {
  text: string
  readings: string[]
  /** Code-point offsets in the reference. */
  start: number
  end: number
}

/** A stretch of the reference; a bracketed one also has other spellings of the whole stretch, or may be left out. */
export interface Segment {
  pieces: Piece[]
  bracketed: boolean
  spellings: string[]
  optional: boolean
  start: number
  end: number
}

/** A reference sentence read from its annotated line. */
export interface Annotated {
  reference: string
  segments: Segment[]
}

const KANA = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u
/** The characters of the notation, which a reference annotated in it cannot contain. */
export const NOTATION_CHARACTERS = /[《》［］／｜]/u

/** Katakana as the hiragana of the same sound, so that ネコ and ねこ, or スラック and すらっく, compare equal. */
export const foldKana = (text: string): string => text.replace(/[ァ-ヶヽヾ]/gu, (kana) => String.fromCodePoint(kana.codePointAt(0)! - 0x60))

/**
 * Reads a sentence annotated with its readings and accepted spellings. 漢字《よみ》 gives the reading of the run of
 * kanji just before it; ｜ marks where a base that is not such a run starts (｜Zoom《ズーム》); ／ separates two
 * readings; ［as written／other／…］ gives other spellings of the whole stretch, an empty one meaning that it may
 * be left out. Taking the marks away leaves the reference. Every character that is scored and not kana needs a
 * reading, so that a transcription in kana can always be scored.
 */
export function parseAnnotated(line: string): Annotated & { errors: string[] } {
  const errors: string[] = []
  const segments: Segment[] = []
  let pieces: Piece[] = []
  let buffer = ''
  let explicitBase = false
  let bracket: { pieces: Piece[]; spellings: string[]; part: number } | null = null
  let at = 0
  const target = (): Piece[] => bracket?.pieces ?? pieces
  const push = (text: string, readings: string[]): void => {
    const length = [...text].length
    target().push({ text, readings, start: at, end: at + length })
    at += length
  }
  const plain = (): void => {
    if (buffer !== '') push(buffer, [])
    buffer = ''
  }
  const inSpelling = (): boolean => bracket !== null && bracket.part > 0
  const characters = [...line]
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!
    if (character === '｜' || character === '《') {
      if (inSpelling()) {
        errors.push('a reading is given inside another spelling; readings go on the stretch as written only')
        if (character === '《') index = Math.max(index, characters.indexOf('》', index))
        continue
      }
    }
    if (character === '｜') {
      plain()
      explicitBase = true
    } else if (character === '《') {
      const close = characters.indexOf('》', index)
      if (close < 0) {
        errors.push('《 is not closed with 》')
        break
      }
      const readings = characters.slice(index + 1, close).join('').split('／')
      index = close
      const base = explicitBase ? buffer : (/\p{Script=Han}+$/u.exec(buffer)?.[0] ?? '')
      if (!explicitBase && base === '') {
        errors.push(`《${readings.join('／')}》 follows no kanji; put ｜ where its base starts`)
        continue
      }
      buffer = buffer.slice(0, buffer.length - base.length)
      plain()
      explicitBase = false
      if (base === '') errors.push(`《${readings.join('／')}》 has no base after ｜`)
      else if (KANA.test(base)) errors.push(`"${base}" is written in kana already and takes no reading`)
      for (const reading of readings) if (!KANA.test(reading)) errors.push(`the reading "${reading}" of "${base}" is not kana only`)
      push(base, readings)
    } else if (character === '［') {
      if (bracket) {
        errors.push('brackets do not nest')
        continue
      }
      plain()
      if (pieces.length > 0) segments.push(segmentOf(pieces, [], false))
      pieces = []
      bracket = { pieces: [], spellings: [], part: 0 }
    } else if (character === '／' && bracket) {
      if (bracket.part === 0) plain()
      else bracket.spellings.push(buffer)
      buffer = ''
      bracket.part++
    } else if (character === '］' && bracket) {
      if (bracket.part === 0) {
        errors.push('［］ gives no other spelling; separate them with ／')
        plain()
      } else bracket.spellings.push(buffer)
      buffer = ''
      segments.push(segmentOf(bracket.pieces, bracket.spellings, true))
      bracket = null
    } else if (NOTATION_CHARACTERS.test(character)) {
      errors.push(`${character} stands where the notation does not allow it`)
    } else {
      buffer += character
    }
  }
  if (explicitBase) errors.push('｜ is not followed by a base and its 《reading》')
  if (bracket) errors.push('［ is not closed with ］')
  plain()
  if (pieces.length > 0) segments.push(segmentOf(pieces, [], false))
  const reference = segments.flatMap((segment) => segment.pieces.map((piece) => piece.text)).join('')
  if (errors.length === 0) errors.push(...meaningErrors(reference, segments))
  return { reference, segments, errors }
}

function segmentOf(pieces: Piece[], parts: string[], bracketed: boolean): Segment {
  return {
    pieces,
    bracketed,
    spellings: parts.filter((part) => part !== ''),
    optional: parts.includes(''),
    start: pieces[0]?.start ?? 0,
    end: pieces.at(-1)?.end ?? 0
  }
}

/** The units of a spelling put in place of a stretch, read with the characters on either side, so that a mark between numerals stays. */
export function unitsInPlace(spelling: string, before: string, after: string): string[] {
  const offset = [...before].length
  const length = [...spelling].length
  return characterUnits(before + spelling + after).filter((unit) => unit.start >= offset && unit.start < offset + length).map((unit) => unit.text)
}

/** Every scored character not in kana needs a reading, and another spelling must be scored differently from what is there already. */
function meaningErrors(reference: string, segments: readonly Segment[]): string[] {
  const errors: string[] = []
  const units = characterUnits(reference)
  const characters = [...reference]
  for (const segment of segments) {
    for (const piece of segment.pieces.filter((candidate) => candidate.readings.length === 0)) {
      const starts = new Set(units.filter((unit) => unit.start >= piece.start && unit.end <= piece.end && !KANA.test(unit.text)).map((unit) => unit.start))
      for (const start of starts) errors.push(`"${characters[start]}" in "${piece.text}" has no reading`)
    }
    if (!segment.bracketed) continue
    const written = characters.slice(segment.start, segment.end).join('')
    const before = characters.slice(Math.max(0, segment.start - 1), segment.start).join('')
    const after = characters.slice(segment.end, segment.end + 1).join('')
    const asWritten = units.filter((unit) => unit.start >= segment.start && unit.end <= segment.end).map((unit) => unit.text).join('')
    const read = foldKana(segment.pieces.map((piece) => piece.readings[0] ?? piece.text).join(''))
    for (const spelling of segment.spellings) {
      const scored = unitsInPlace(spelling, before, after).join('')
      if (scored === asWritten) errors.push(`［${written}／${spelling}］: "${spelling}" is scored the same as the stretch as written`)
      else if (foldKana(scored) === read) errors.push(`［${written}／${spelling}］: "${spelling}" is what the readings give already`)
    }
  }
  return errors
}
