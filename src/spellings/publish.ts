import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../core/paths.ts'
import { commonVoiceTestClips } from '../datasets/common-voice.ts'
import { readSpellingRecords, sentenceKey, spellingsFile, type SpellingRecord } from './files.ts'
import { parseAnnotated } from './notation.ts'

/** The dataset on Hugging Face that holds the annotations of Common Voice. */
export const PUBLISHED_DATASET = 'sakasegawa/common-voice-ja-accepted-spellings'

/** Where the export writes the dataset unless told otherwise. */
export const publishedFolder = (): string => path.join(dataDir(), 'huggingface', 'common-voice-ja-accepted-spellings')

/** Its card and its scorer, which the export copies beside the annotations. */
const CARD = path.join(import.meta.dirname, '..', '..', 'huggingface', 'common-voice-ja-accepted-spellings')

/** The sources published, each as a config of the dataset with the test split alone. */
const PUBLISHED: ReadonlyArray<{ source: string; locale: string; config: string }> = [{ source: 'common-voice-8-ja-JP', locale: 'ja-JP', config: '8.0' }]

/** One row of the published annotations: a clip with the annotation of its sentence, in fields a reader without the bench can use. */
export interface PublishedRow {
  clip: string
  sentence: string
  sentence_sha256: string
  /** The sentence in the notation of `spellings/`. */
  annotation: string
  /** The annotation read: the stretches of the sentence in order, whose texts give back the sentence. */
  segments: Array<{ bracketed: boolean; optional: boolean; spellings: string[]; pieces: Array<{ text: string; readings: string[] }> }>
  note: string | null
  annotator: string
  /** The commit of the skill in nyosegawa/speech-bench. */
  skill: string
  annotated_at: string
}

/**
 * The rows of the clips in their order, each with the annotation of its sentence. A clip whose sentence is not
 * annotated stops it, since a published split with a sentence missing could not be scored whole.
 */
export function publishedRows(clips: ReadonlyArray<{ clip: string; sentence: string }>, records: readonly SpellingRecord[]): PublishedRow[] {
  const annotated = new Map(records.map((record) => {
    const { errors, reference, segments } = parseAnnotated(record.line)
    if (errors.length > 0) throw new Error(`the annotation ${record.line} does not read: ${errors.join('; ')}`)
    return [reference, { record, segments }]
  }))
  const missing = clips.filter((clip) => !annotated.has(clip.sentence))
  if (missing.length > 0) throw new Error(`${missing.length} clips have sentences that are not annotated, the first ${missing[0]!.clip}; annotate them with spellings annotate before exporting`)
  return clips.map(({ clip, sentence }) => {
    const { record, segments } = annotated.get(sentence)!
    return {
      clip,
      sentence,
      sentence_sha256: sentenceKey(sentence),
      annotation: record.line,
      segments: segments.map((segment) => ({
        bracketed: segment.bracketed,
        optional: segment.optional,
        spellings: segment.spellings,
        pieces: segment.pieces.map((piece) => ({ text: piece.text, readings: piece.readings }))
      })),
      note: record.note ?? null,
      annotator: record.by,
      skill: record.skill,
      annotated_at: record.at
    }
  })
}

/**
 * Writes the dataset as it is uploaded: its card and scorer, and `<config>/test.jsonl` of each source published.
 * Returns the files written.
 */
export async function exportPublished(folder: string): Promise<string[]> {
  const written: string[] = []
  for (const { source, locale, config } of PUBLISHED) {
    const rows = publishedRows(await commonVoiceTestClips(locale), readSpellingRecords(spellingsFile(source)))
    const file = path.join(folder, config, 'test.jsonl')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
    written.push(file)
  }
  for (const name of ['README.md', 'score.py']) {
    fs.copyFileSync(path.join(CARD, name), path.join(folder, name))
    written.push(path.join(folder, name))
  }
  return written
}
