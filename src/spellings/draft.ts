import fs from 'node:fs'
import { NOTATION_CHARACTERS, parseAnnotated } from './notation.ts'

/**
 * The files an agent works with while it annotates: the sentences to annotate, numbered from 0 in the order of
 * `items.jsonl`, and its draft, `spellings.jsonl`, which only `addChunk` writes.
 */

/** A sentence to annotate. */
export interface Item {
  sentence: string
  reference: string
}

/** A sentence as the agent annotated it. */
export interface Drafted {
  sentence: string
  line: string
  note?: string
}

const jsonLines = <T>(file: string): T[] =>
  fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as T) : []

export const readItems = (file: string): Item[] => jsonLines<Item>(file)

export const readDraft = (file: string): Map<string, Drafted> => new Map(jsonLines<Drafted>(file).map((drafted) => [drafted.sentence, drafted]))

/** What is wrong with an annotated line of an item: it must read, and give back the item's reference exactly. */
export function lineErrors(item: Item, line: string): string[] {
  if (NOTATION_CHARACTERS.test(item.reference)) return ['the sentence contains a character of the notation (《》［］／｜) and cannot be annotated in it; report it']
  const { reference, errors } = parseAnnotated(line)
  if (errors.length > 0) return errors
  return reference === item.reference ? [] : [`without the marks the line reads "${reference}", not "${item.reference}"; copy the sentence again`]
}

/** The sentences of a range, one per line as `<number><TAB><sentence>`, with what is drafted for them so far. */
export function showLines(items: readonly Item[], drafted: ReadonlyMap<string, Drafted>, from: number, to: number): string[] {
  return items.slice(from, to).flatMap((item, offset) => {
    const draft = drafted.get(item.sentence)
    return [`${from + offset}\t${item.reference}`, ...(draft ? [`  drafted: ${draft.line}${draft.note ? `\t${draft.note}` : ''}`] : [])]
  })
}

/**
 * Checks a chunk of lines `<number><TAB><annotated sentence>[<TAB><note>]` and, only when every line is right,
 * puts them into the draft, in the order of the items.
 */
export function addChunk(items: readonly Item[], draftFile: string, chunk: string): { errors: string[]; added: number[]; skipped: number[]; annotated: number } {
  const drafted = readDraft(draftFile)
  const errors: string[] = []
  const added: number[] = []
  chunk.split('\n').forEach((text, row) => {
    if (text.trim() === '') return
    const [number, line, note, ...rest] = text.split('\t')
    const index = Number(number)
    if (!/^\d+$/.test(number ?? '') || index >= items.length) {
      errors.push(`chunk line ${row + 1}: "${number}" is not the number of a sentence (0 to ${items.length - 1})`)
      return
    }
    if (line === undefined || rest.length > 0) {
      errors.push(`chunk line ${row + 1}: write <number><TAB><annotated sentence>[<TAB><note>]`)
      return
    }
    if (added.includes(index)) errors.push(`[${index}] is written twice in the chunk`)
    const item = items[index]!
    errors.push(...lineErrors(item, line).map((error) => `[${index}] ${error}`))
    added.push(index)
    drafted.set(item.sentence, { sentence: item.sentence, line, ...(note?.trim() ? { note: note.trim() } : {}) })
  })
  const annotatedIndexes = items.flatMap((item, index) => (drafted.has(item.sentence) ? [index] : []))
  const highest = Math.max(-1, ...annotatedIndexes)
  const skipped = items.flatMap((item, index) => (index < highest && !drafted.has(item.sentence) ? [index] : []))
  if (errors.length > 0) return { errors, added: [], skipped, annotated: readDraft(draftFile).size }
  fs.writeFileSync(draftFile, items.flatMap((item) => {
    const draft = drafted.get(item.sentence)
    return draft ? [JSON.stringify(draft)] : []
  }).join('\n') + '\n')
  return { errors, added, skipped, annotated: annotatedIndexes.length }
}

/** What is wrong with the draft of a range, a sentence without a line included. */
export function draftErrors(items: readonly Item[], drafted: ReadonlyMap<string, Drafted>, from: number, to: number): string[] {
  return items.slice(from, to).flatMap((item, offset) => {
    const draft = drafted.get(item.sentence)
    if (!draft) return [`[${from + offset}] has no line yet`]
    return lineErrors(item, draft.line).map((error) => `[${from + offset}] ${error}`)
  })
}
