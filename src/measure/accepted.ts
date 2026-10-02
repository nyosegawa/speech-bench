import { characterUnits, type ErrorCount } from './scoring.ts'
import { foldKana, unitsInPlace, type Segment } from '../spellings/notation.ts'

/**
 * The edit distances from the start of a reference to each prefix of what was heard, carried one stretch further:
 * the lowest over the ways through the stretch, each a series of units, then any units heard after it.
 */
function advance(row: readonly number[], ways: ReadonlyArray<readonly string[]>, heard: readonly string[]): number[] {
  const best = ways.map((way) => {
    let previous = [...row]
    for (const unit of way) {
      const current = [previous[0]! + 1]
      for (let column = 1; column <= heard.length; column++) {
        current.push(Math.min(previous[column]! + 1, current[column - 1]! + 1, previous[column - 1]! + (unit === heard[column - 1] ? 0 : 1)))
      }
      previous = current
    }
    return previous
  }).reduce((lowest, candidate) => lowest.map((value, column) => Math.min(value, candidate[column]!)))
  for (let column = 1; column <= heard.length; column++) best[column] = Math.min(best[column]!, best[column - 1]! + 1)
  return best
}

/**
 * The errors of a transcription against the closest way through its reference: any part in the kana of its
 * reading, hiragana and katakana alike, a bracketed stretch as one of its other spellings, and an optional one
 * left out. The length stays that of the reference as written.
 */
export function countAcceptedErrors(reference: string, segments: readonly Segment[], hypothesis: string): ErrorCount {
  const units = characterUnits(reference)
  const characters = [...reference]
  const heard = characterUnits(hypothesis).map((unit) => foldKana(unit.text))
  const written = (start: number, end: number): string[] => units.filter((unit) => unit.start >= start && unit.end <= end).map((unit) => foldKana(unit.text))
  const asRead = (text: string): string[] => characterUnits(text).map((unit) => foldKana(unit.text))
  let row = Array.from({ length: heard.length + 1 }, (_, column) => column)
  for (const segment of segments) {
    const start = row
    for (const piece of segment.pieces) row = advance(row, [written(piece.start, piece.end), ...piece.readings.map(asRead)], heard)
    if (!segment.bracketed) continue
    const before = characters.slice(Math.max(0, segment.start - 1), segment.start).join('')
    const after = characters.slice(segment.end, segment.end + 1).join('')
    const others = [...segment.spellings.map((spelling) => unitsInPlace(spelling, before, after).map(foldKana)), ...(segment.optional ? [[]] : [])]
    const other = advance(start, others, heard)
    row = row.map((value, column) => Math.min(value, other[column]!))
  }
  return { errors: row[heard.length]!, referenceLength: units.length }
}
