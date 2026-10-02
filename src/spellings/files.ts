import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseAnnotated, type Annotated } from './notation.ts'

/**
 * The annotations of the reference sentences that ship with the bench, `spellings/<source>-<locale>.jsonl`, one
 * sentence per line: the sentence in the notation, a note, and who made it with which skill when.
 */
const SPELLINGS = path.join(import.meta.dirname, '..', '..', 'spellings')

/** One line of an annotation file. */
export interface SpellingRecord {
  line: string
  note?: string
  /** The agent and model that made it, or the person who wrote it. */
  by: string
  /** The commit of the skill it was made with. */
  skill: string
  /** The day it was made, YYYY-MM-DD. */
  at: string
}

/** Annotated sentences by the sha256 of their reference text. */
export type Spellings = ReadonlyMap<string, Annotated & { record: SpellingRecord }>

export const sentenceKey = (reference: string): string => createHash('sha256').update(reference, 'utf8').digest('hex')

function recordOf(raw: unknown): SpellingRecord | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'is not an object'
  const record = raw as Record<string, unknown>
  const extra = Object.keys(record).filter((key) => !['line', 'note', 'by', 'skill', 'at'].includes(key))
  if (extra.length > 0) return `has fields it should not: ${extra.join(', ')}`
  for (const key of ['line', 'by', 'skill', 'at']) if (typeof record[key] !== 'string' || record[key] === '') return `needs the string ${key}`
  if (record.note !== undefined && typeof record.note !== 'string') return 'has a note that is not a string'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.at as string)) return `has the date ${String(record.at)}, not YYYY-MM-DD`
  return record as unknown as SpellingRecord
}

/**
 * The annotated sentences of a locale, from every `*-<locale>.jsonl` in the folder. A line that does not read, and a
 * sentence annotated twice, stop it: a rate counted against them could not be trusted.
 */
export function readSpellings(locale: string, folder = SPELLINGS): Spellings {
  const annotated = new Map<string, Annotated & { record: SpellingRecord }>()
  const where = new Map<string, string>()
  if (!fs.existsSync(folder)) return annotated
  for (const file of fs.readdirSync(folder).filter((name) => name.endsWith(`-${locale}.jsonl`)).sort()) {
    fs.readFileSync(path.join(folder, file), 'utf8').split('\n').forEach((text, index) => {
      if (text.trim() === '') return
      const place = `${path.join('spellings', file)} line ${index + 1}`
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        throw new Error(`${place} is not JSON`)
      }
      const record = recordOf(raw)
      if (typeof record === 'string') throw new Error(`${place} ${record}`)
      const { errors, ...sentence } = parseAnnotated(record.line)
      if (errors.length > 0) throw new Error(`${place} does not read: ${errors.join('; ')}`)
      const key = sentenceKey(sentence.reference)
      const earlier = where.get(key)
      if (earlier) throw new Error(`${place} annotates the sentence ${earlier} annotates already; keep one of them`)
      where.set(key, place)
      annotated.set(key, { ...sentence, record })
    })
  }
  return annotated
}

/** The sources the bench has annotations of, by the names of their files. */
export const spellingSources = (folder = SPELLINGS): string[] =>
  fs.existsSync(folder) ? fs.readdirSync(folder).filter((name) => name.endsWith('.jsonl')).map((name) => name.slice(0, -'.jsonl'.length)).sort() : []

/** The annotation file of a source, such as `fleurs-ja-JP`. */
export const spellingsFile = (source: string, folder = SPELLINGS): string => path.join(folder, `${source}.jsonl`)

/** The records of one annotation file in the order they stand, or none when it does not exist yet. */
export function readSpellingRecords(file: string): SpellingRecord[] {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').flatMap((text, index) => {
    if (text.trim() === '') return []
    const record = recordOf(JSON.parse(text))
    if (typeof record === 'string') throw new Error(`${file} line ${index + 1} ${record}`)
    return [record]
  })
}

export function writeSpellingRecords(file: string, records: readonly SpellingRecord[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join('\n') + '\n')
}

/** A reader that reads the annotations of each locale once. */
export function spellingsReader(folder = SPELLINGS): (locale: string) => Spellings {
  const read = new Map<string, Spellings>()
  return (locale) => {
    const known = read.get(locale)
    if (known) return known
    const spellings = readSpellings(locale, folder)
    read.set(locale, spellings)
    return spellings
  }
}
