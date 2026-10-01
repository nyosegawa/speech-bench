import fs from 'node:fs'
import path from 'node:path'
import type { SpeakerEmbedder } from './engines/speaker-embedding.ts'
import { medianPitch, semitoneSpread } from './pitch.ts'
import { parseResultFile, type SentenceRecord, type TtsRunRecord } from './results.ts'
import { countHeardErrors } from './scoring.ts'
import { cosine, likenessToTheRest, MIN_VOICED_SECONDS, voicedSeconds } from './speaker.ts'
import { readWav } from './wav.ts'

const PAGE = path.join(import.meta.dirname, 'listen-page.html')

/**
 * One synthesis run as the listening page shows it: the result file, its run line, its sentences, and what
 * is read from each sentence's audio: the median pitch, or null where it has none, and how much its voice
 * sounds like the run's other sentences, the mean similarity of their speaker embeddings, or null for a
 * sentence with too little voice to tell who speaks; its speaker embedding, or null for such a sentence; and,
 * when the page compares the runs with a reference voice, how much each sentence sounds like it.
 */
export interface ListenedRun {
  file: string
  run: TtsRunRecord
  sentences: SentenceRecord[]
  pitches: Readonly<Record<string, number | null>>
  likeness: Readonly<Record<string, number | null>>
  embeddings: Readonly<Record<string, Float32Array | null>>
  likeReference: Readonly<Record<string, number | null>>
}

const audioFile = (file: string, record: SentenceRecord): string => path.join(path.dirname(file), path.basename(file, '.jsonl'), record.audio)

/** Where a take's audio is, as a link relative to the folder of the page at `page`, so that it opens from the file system. */
export const takeUrl = (page: string, entry: ListenedRun, record: SentenceRecord): string =>
  path.relative(path.dirname(page), audioFile(entry.file, record)).split(path.sep).map(encodeURIComponent).join('/')

/** The characters the recognizer heard wrong in the sentences, each at most all of its own, as a share of the characters they have. */
export function heardErrorRate(records: readonly SentenceRecord[], locale: string): number {
  const counts = records.map((record) => countHeardErrors(record.text, record.transcript, locale))
  return counts.reduce((sum, count) => sum + count.errors, 0) / counts.reduce((sum, count) => sum + count.referenceLength, 0)
}

/**
 * The synthesis runs among the result files that `keep` takes, each sentence also compared with the embedding
 * of the reference voice `referenceOf` gives for its run, if any. Only the runs kept are embedded.
 */
export function readTtsRuns(files: readonly string[], embedder: SpeakerEmbedder, keep: (run: TtsRunRecord) => boolean = () => true, referenceOf: (run: TtsRunRecord) => Float32Array | undefined = () => undefined): ListenedRun[] {
  return files.flatMap((file) => {
    const parsed = parseResultFile(fs.readFileSync(file, 'utf8').split('\n'))
    if (!('sentences' in parsed) || !keep(parsed.run)) return []
    const audio = parsed.sentences.map((record) => readWav(fs.readFileSync(audioFile(file, record))))
    const pitches = Object.fromEntries(parsed.sentences.map((record, index) => [record.id, medianPitch(audio[index]!)]))
    const judged = parsed.sentences.flatMap((record, index) => (voicedSeconds(audio[index]!) >= MIN_VOICED_SECONDS ? [{ id: record.id, pcm: audio[index]! }] : []))
    const embeddings = judged.map(({ pcm }) => embedder.embed(pcm))
    const likenesses = likenessToTheRest(embeddings)
    const judgedAt = (id: string): number => judged.findIndex((take) => take.id === id)
    const likeness = Object.fromEntries(parsed.sentences.map((record) => [record.id, likenesses[judgedAt(record.id)] ?? null]))
    const embeddingOf = Object.fromEntries(parsed.sentences.map((record) => [record.id, embeddings[judgedAt(record.id)] ?? null]))
    const reference = referenceOf(parsed.run)
    const likeReference = Object.fromEntries(parsed.sentences.map((record) => {
      const embedding = embeddings[judgedAt(record.id)]
      return [record.id, reference && embedding ? cosine(embedding, reference) : null]
    }))
    return [{ file, run: parsed.run, sentences: parsed.sentences, pitches, likeness, embeddings: embeddingOf, likeReference }]
  })
}

/**
 * The newest run of each model and runtime, voice, description, reference, length factor and seed on each machine, since a model
 * measured again replaces its earlier speech on the page. Runs are compared only within one set of sentences.
 */
export function latestRuns(runs: readonly ListenedRun[]): ListenedRun[] {
  const latest = new Map<string, ListenedRun>()
  for (const entry of runs) {
    const { run } = entry
    const key = [run.set.name, run.model.id, run.runtime.id, run.voice ?? '', run.design?.id ?? '', run.reference?.name ?? '', run.durationScale ?? '', run.seed ?? '', run.machine.hostname].join('\u0000')
    const known = latest.get(key)
    if (!known || known.run.startedAt < entry.run.startedAt) latest.set(key, entry)
  }
  return [...latest.values()]
}

const describe: Array<(entry: ListenedRun) => string | null> = [
  (entry) => entry.run.model.label,
  (entry) => `${entry.run.runtime.id} ${entry.run.runtime.version}`,
  (entry) => entry.run.voice,
  (entry) => entry.run.design?.id ?? null,
  (entry) => (entry.run.reference ? `reference ${entry.run.reference.name}` : null),
  (entry) => (entry.run.durationScale === null ? null : `length ×${entry.run.durationScale}`),
  (entry) => (entry.run.seed === null ? null : `seed ${entry.run.seed}`),
  (entry) => entry.run.machine.gpus.join(' + '),
  (entry) => Object.entries(entry.run.runtime.options).map(([name, value]) => `${name}=${value}`).join(', ') || null
]

/**
 * The names of the runs and what they share. A run is named by the model, voice, design, seed and GPU it differs
 * from the others in, so that five seeds of one model read as "seed 1" to "seed 5" and one model on two
 * machines is told apart; what every run shares is said once.
 */
export function runNames(runs: readonly ListenedRun[]): { names: string[]; shared: string } {
  const varies = (part: (entry: ListenedRun) => string | null): boolean => new Set(runs.map(part)).size > 1
  const naming = describe.some(varies) ? describe.filter(varies) : describe.slice(0, 1)
  const join = (parts: ReadonlyArray<string | null>): string => parts.filter((part) => part !== null).join(', ')
  return {
    names: runs.map((entry) => join(naming.map((part) => part(entry)))),
    shared: join(describe.filter((part) => !naming.includes(part)).map((part) => part(runs[0]!)))
  }
}

/** What the page's script reads: the runs and, for each sentence, the take of each run. */
export interface PageData {
  title: string
  /** The one reference voice every run is compared with, by name, or null when each is compared with its own. */
  reference: string | null
  shared: string
  blind: boolean
  runs: Array<{ name: string; instruction?: string; heardErrorRate?: number; medianFirstAudioSeconds?: number; pitchHz?: number | null; pitchSpread?: number; sameVoice?: number; likeReference?: number | null }>
  sentences: Array<{
    id: string
    kind: string
    text: string
    takes: Array<{ url: string; seconds: number; transcript?: string; heardErrorRate?: number; firstAudioSeconds?: number; pitchHz?: number | null; likeness?: number | null; likeReference?: number | null } | null>
  }>
  key?: string[]
}

const meanOrNull = (values: readonly number[]): number | null => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length)

/** How much a run sounds like the reference it was compared with, over its sentences with enough voice, or null. */
const likeReferenceOf = (entry: ListenedRun): number | null =>
  meanOrNull(entry.sentences.map((record) => entry.likeReference[record.id]).filter((value): value is number => typeof value === 'number'))

const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN
const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length

/**
 * The data of a page that plays every sentence as each run spoke it. `page` is where the page will be
 * written, which the audio is linked relative to so that it opens from the file system. A blind page names
 * the runs by letter, shuffles their order, leaves out the voice descriptions, what the recognizer heard, the
 * timings, the pitches and the likenesses, and keeps the names for a closed section at the end. A run's
 * pitch is the median of its sentences' and its spread their standard deviation in semitones; its sameness
 * of voice is the mean similarity of every pair of its sentences with voice enough to judge. Both show a
 * voice that changes between sentences.
 */
export function listeningData(runs: readonly ListenedRun[], page: string, blind: boolean, random: () => number = Math.random, reference: string | null = null): PageData {
  const setNames = new Set(runs.map((entry) => entry.run.set.name))
  if (setNames.size !== 1) throw new Error(`the runs spoke different sets of sentences (${[...setNames].join(', ')}); name the result files of one set`)
  const ordered = blind ? [...runs].map((entry) => ({ entry, order: random() })).sort((a, b) => a.order - b.order).map(({ entry }) => entry) : [...runs]
  const { names, shared } = runNames(ordered)
  const locale = ordered[0]!.run.set.locale
  const pitchesOf = (entry: ListenedRun): number[] => entry.sentences.map((record) => entry.pitches[record.id]).filter((hz): hz is number => typeof hz === 'number')
  const rate = (records: readonly SentenceRecord[]): number => heardErrorRate(records, locale)
  return {
    title: ordered[0]!.run.set.name,
    reference,
    shared,
    blind,
    runs: ordered.map((entry, index) => (blind
      ? { name: String.fromCharCode(65 + index) }
      : {
          name: names[index]!,
          ...(entry.run.design ? { instruction: entry.run.design.instruction } : {}),
          heardErrorRate: rate(entry.sentences),
          medianFirstAudioSeconds: median(entry.sentences.map((record) => record.firstAudioSeconds)),
          pitchHz: pitchesOf(entry).length > 0 ? median(pitchesOf(entry)) : null,
          pitchSpread: semitoneSpread(pitchesOf(entry)),
          sameVoice: mean(entry.sentences.map((record) => entry.likeness[record.id]).filter((value): value is number => typeof value === 'number')),
          likeReference: likeReferenceOf(entry)
        })),
    sentences: ordered[0]!.sentences.map((sentence) => ({
      id: sentence.id,
      kind: sentence.kind,
      text: sentence.text,
      takes: ordered.map((entry) => {
        const record = entry.sentences.find((candidate) => candidate.id === sentence.id)
        if (!record) return null
        const take = { url: takeUrl(page, entry, record), seconds: record.audioSeconds }
        return blind ? take : { ...take, transcript: record.transcript, heardErrorRate: rate([record]), firstAudioSeconds: record.firstAudioSeconds, pitchHz: entry.pitches[record.id] ?? null, likeness: entry.likeness[record.id] ?? null, likeReference: entry.likeReference[record.id] ?? null }
      })
    })),
    ...(blind ? { key: ordered.map((_, index) => `${String.fromCharCode(65 + index)}: ${names[index]!}`) } : {})
  }
}

/** The listening page: the data above in the page's template, safe to embed in a script element. */
export function listeningPage(runs: readonly ListenedRun[], page: string, blind: boolean, random: () => number = Math.random, reference: string | null = null): string {
  const data = listeningData(runs, page, blind, random, reference)
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return fs.readFileSync(PAGE, 'utf8').replace('__TITLE__', data.title.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)).replace('__DATA__', () => json)
}
