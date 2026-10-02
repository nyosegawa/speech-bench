import { characterUnits, type ErrorCount } from './scoring.ts'
import { foldKana, unitsInPlace, type Piece, type Segment } from '../spellings/notation.ts'

/** How a stretch of the reference was taken, when not as written: its text, and the reading or spelling it was read as. */
export interface Taken {
  written: string
  as: string
}

/** One step of an alignment: a unit of the way through the reference and a unit heard, or one of them alone. */
export interface AcceptedStep {
  reference: string | null
  hypothesis: string | null
  /** A unit heard as the way through has it, hiragana and katakana alike. */
  right: boolean
  /** The reading or other spelling the reference unit comes from. */
  taken?: Taken
}

/** A unit of a way through the reference, or none on an edge that only joins two ways. */
interface Edge {
  from: number
  to: number
  unit: string | null
  key: string
  taken?: Taken
}

/**
 * The reference as a graph whose every path from the first node to the last reads it: as written, a part in the kana
 * of its reading, a bracketed stretch as one of its other spellings, or without an optional one. Each edge leads to
 * a node numbered above its own, so the nodes can be taken in order.
 */
function graphOf(reference: string, segments: readonly Segment[]): { edges: Edge[]; nodes: number } {
  const units = characterUnits(reference)
  const characters = [...reference]
  const edges: Edge[] = []
  let nodes = 1
  const chain = (from: number, texts: readonly string[], taken?: Taken): number => {
    let node = from
    for (const text of texts) {
      edges.push({ from: node, to: nodes, unit: text, key: foldKana(text), ...(taken ? { taken } : {}) })
      node = nodes++
    }
    return node
  }
  const choice = (from: number, ways: ReadonlyArray<(start: number) => number>): number => {
    const ends = ways.map((way) => way(from))
    const end = nodes++
    for (const last of ends) edges.push({ from: last, to: end, unit: null, key: '' })
    return end
  }
  const written = (start: number, end: number): string[] => units.filter((unit) => unit.start >= start && unit.end <= end).map((unit) => unit.text)
  const throughPieces = (from: number, pieces: readonly Piece[]): number => pieces.reduce((node, piece) => (piece.readings.length === 0
    ? chain(node, written(piece.start, piece.end))
    : choice(node, [
      (start) => chain(start, written(piece.start, piece.end)),
      ...piece.readings.map((reading) => (start: number) => chain(start, characterUnits(reading).map((unit) => unit.text), { written: piece.text, as: reading }))
    ])), from)
  let node = 0
  for (const segment of segments) {
    if (!segment.bracketed) {
      node = throughPieces(node, segment.pieces)
      continue
    }
    const text = characters.slice(segment.start, segment.end).join('')
    const before = characters.slice(Math.max(0, segment.start - 1), segment.start).join('')
    const after = characters.slice(segment.end, segment.end + 1).join('')
    node = choice(node, [
      (start) => throughPieces(start, segment.pieces),
      ...segment.spellings.map((spelling) => (start: number) => chain(start, unitsInPlace(spelling, before, after), { written: text, as: spelling })),
      ...(segment.optional ? [(start: number) => start] : [])
    ])
  }
  return { edges, nodes }
}

const MATCH = 1
const DELETE = 2
const INSERT = 3
const SKIP = 4

/**
 * A transcription lined up with the closest way through its reference: any part in the kana of its reading,
 * hiragana and katakana alike, a bracketed stretch as one of its other spellings, an optional one left out. Where
 * two ways are as close, the reference as written comes first. The length stays that of the reference as written.
 */
export function alignAccepted(reference: string, segments: readonly Segment[], hypothesis: string): ErrorCount & { steps: AcceptedStep[] } {
  const heard = characterUnits(hypothesis).map((unit) => unit.text)
  const keys = heard.map(foldKana)
  const { edges, nodes } = graphOf(reference, segments)
  const incoming: number[][] = Array.from({ length: nodes }, () => [])
  edges.forEach((edge, index) => incoming[edge.to]!.push(index))
  const width = heard.length + 1
  const cost = [Float64Array.from({ length: width }, (_, column) => column)]
  const moves = [Uint8Array.from({ length: width }, (_, column) => (column === 0 ? 0 : INSERT))]
  const via = [new Int32Array(width).fill(-1)]
  for (let node = 1; node < nodes; node++) {
    const row = new Float64Array(width).fill(Infinity)
    const move = new Uint8Array(width)
    const edgeOf = new Int32Array(width).fill(-1)
    for (const index of incoming[node]!) {
      const edge = edges[index]!
      const previous = cost[edge.from]!
      for (let column = 0; column < width; column++) {
        if (edge.unit === null) {
          if (previous[column]! < row[column]!) [row[column], move[column], edgeOf[column]] = [previous[column]!, SKIP, index]
          continue
        }
        if (previous[column]! + 1 < row[column]!) [row[column], move[column], edgeOf[column]] = [previous[column]! + 1, DELETE, index]
        if (column === 0) continue
        const matched = previous[column - 1]! + (edge.key === keys[column - 1] ? 0 : 1)
        if (matched < row[column]!) [row[column], move[column], edgeOf[column]] = [matched, MATCH, index]
      }
    }
    for (let column = 1; column < width; column++) {
      if (row[column - 1]! + 1 < row[column]!) [row[column], move[column], edgeOf[column]] = [row[column - 1]! + 1, INSERT, -1]
    }
    cost.push(row)
    moves.push(move)
    via.push(edgeOf)
  }
  const steps: AcceptedStep[] = []
  let node = nodes - 1
  let column = heard.length
  while (node !== 0 || column !== 0) {
    const move = moves[node]![column]!
    const edge = edges[via[node]![column]!]
    if (move === INSERT) {
      steps.push({ reference: null, hypothesis: heard[--column]!, right: false })
      continue
    }
    if (move === MATCH) steps.push({ reference: edge!.unit, hypothesis: heard[column - 1]!, right: edge!.key === keys[column - 1], ...(edge!.taken ? { taken: edge!.taken } : {}) })
    else if (move === DELETE) steps.push({ reference: edge!.unit, hypothesis: null, right: false, ...(edge!.taken ? { taken: edge!.taken } : {}) })
    if (move === MATCH) column--
    node = edge!.from
  }
  return { errors: cost[nodes - 1]![heard.length]!, referenceLength: characterUnits(reference).length, steps: steps.reverse() }
}

/** The errors of a transcription against the closest way through its reference, as alignAccepted counts them. */
export function countAcceptedErrors(reference: string, segments: readonly Segment[], hypothesis: string): ErrorCount {
  const { errors, referenceLength } = alignAccepted(reference, segments, hypothesis)
  return { errors, referenceLength }
}
