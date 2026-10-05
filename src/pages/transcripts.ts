import fs from 'node:fs'
import { describeAudio, summarize, type AsrSummary } from '../measure/report.ts'
import { isDropped, parseResultFile, type AsrRunRecord, type UtteranceRecord } from '../measure/results.ts'
import { runIdOf } from '../measure/runs.ts'
import { sentenceKey, spellingsReader, type Spellings } from '../spellings/files.ts'
import { alignAccepted, type AcceptedStep } from '../measure/accepted.ts'
import { align, countErrors, type Aligned } from '../measure/scoring.ts'
import { scoredByCharacter } from '../core/language.ts'
import { namesApart } from './naming.ts'

/** What one run heard of an utterance, or why it heard nothing. */
export type Heard =
  | {
    text: string
    errors: number
    referenceLength: number
    alignment: Aligned[]
    /** The errors and alignment against the readings and accepted spellings, when the sentence is annotated. */
    accepted: { errors: number; alignment: AcceptedStep[] } | null
  }
  | { droppedBy: 'no-voice' | 'energy-vad' }

/** What the transcripts page reads: the runs, and for each utterance what every run heard. */
export interface TranscriptsData {
  set: string
  locale: string
  /** Whether the language is scored by character; otherwise by word, and the units of an alignment are words. */
  byCharacter: boolean
  shared: string
  runs: Array<{ id: string; name: string; errorRate: number; acceptedErrorRate: number | null; annotated: number; dropped: number; utterances: number }>
  /** Whether any utterance's sentence is annotated, so that the page can show the alignment with accepted spellings. */
  annotated: boolean
  /** In the order of the first run, then the utterances only later runs had. */
  utterances: Array<{ id: string; reference: string; heard: Array<Heard | null> }>
}

const describe: Array<(run: AsrRunRecord) => string | null> = [
  (run) => run.model.label,
  (run) => `${run.runtime.id} ${run.runtime.version}`,
  (run) => describeAudio(run.audio),
  (run) => run.machine.gpus.join(' + '),
  (run) => Object.entries(run.runtime.options).map(([name, value]) => `${name}=${value}`).join(', ') || null,
  (run) => run.startedAt.slice(0, 16).replace('T', ' ')
]

function heardOf(record: UtteranceRecord, locale: string, spellings: Spellings): Heard {
  if (isDropped(record)) return { droppedBy: record.droppedBy }
  const sentence = spellings.get(sentenceKey(record.reference))
  const accepted = sentence ? alignAccepted(sentence.reference, sentence.segments, record.text) : null
  return {
    text: record.text,
    ...countErrors(record.reference, record.text, locale),
    alignment: align(record.reference, record.text, locale),
    accepted: accepted ? { errors: accepted.errors, alignment: accepted.steps } : null
  }
}

/** Recognition runs of one set side by side, utterance by utterance, each transcription aligned with its reference. */
export function transcriptsData(files: readonly string[], spellingsOf: (locale: string) => Spellings = spellingsReader()): TranscriptsData {
  const runs = files.map((file) => {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    const parsed = parseResultFile(lines)
    if (!('utterances' in parsed)) throw new Error(`${runIdOf(file)} is not a speech recognition run`)
    return { id: runIdOf(file), run: parsed.run, utterances: parsed.utterances, summary: summarize(lines, spellingsOf) as AsrSummary }
  })
  const sets = new Set(runs.map((entry) => entry.run.set.name))
  if (sets.size !== 1) throw new Error(`the runs heard different sets (${[...sets].join(', ')}); choose runs of one set`)
  const { locale, name: set } = runs[0]!.run.set
  const { names, shared } = namesApart(runs.map((entry) => entry.run), describe)
  const ids = [...new Set(runs.flatMap((entry) => entry.utterances.map((record) => record.id)))]
  return {
    set,
    locale,
    byCharacter: scoredByCharacter(locale),
    shared,
    runs: runs.map((entry, index) => ({ id: entry.id, name: names[index]!, errorRate: entry.summary.errorRate, acceptedErrorRate: entry.summary.acceptedErrorRate, annotated: entry.summary.annotated, dropped: entry.summary.dropped, utterances: entry.summary.utterances })),
    annotated: runs.some((entry) => entry.summary.annotated > 0),
    utterances: ids.map((id) => {
      const records = runs.map((entry) => entry.utterances.find((record) => record.id === id))
      return { id, reference: records.find((record) => record !== undefined)!.reference, heard: records.map((record) => (record ? heardOf(record, locale, spellingsOf(locale)) : null)) }
    })
  }
}
