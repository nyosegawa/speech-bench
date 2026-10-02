import { readSpellingRecords, spellingsFile } from '../spellings/files.ts'
import { parseAnnotated, type Segment } from '../spellings/notation.ts'

/** An annotated sentence as the page shows it: its readings and other spellings, its note, and who made it when. */
export interface SpellingSentence {
  reference: string
  segments: Segment[]
  note: string | null
  by: string
  skill: string
  at: string
}

/** What the spellings page reads: the sources annotated, and the sentences of one of them. */
export interface SpellingsData {
  sources: Array<{ source: string; sentences: number; withSpellings: number; withNotes: number }>
  source: string
  sentences: SpellingSentence[]
}

const sentencesOf = (source: string, folder?: string): SpellingSentence[] =>
  readSpellingRecords(spellingsFile(source, folder)).map((record) => {
    const { reference, segments } = parseAnnotated(record.line)
    return { reference, segments, note: record.note ?? null, by: record.by, skill: record.skill, at: record.at }
  })

/** The annotated sentences of `source`, in the order of its file, with a summary of every source in `sources`. */
export function spellingsData(sources: readonly string[], source: string, folder?: string): SpellingsData {
  return {
    sources: sources.map((name) => {
      const sentences = sentencesOf(name, folder)
      return {
        source: name,
        sentences: sentences.length,
        withSpellings: sentences.filter((sentence) => sentence.segments.some((segment) => segment.bracketed)).length,
        withNotes: sentences.filter((sentence) => sentence.note !== null).length
      }
    }),
    source,
    sentences: sentencesOf(source, folder)
  }
}
