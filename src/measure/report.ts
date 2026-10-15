import { gpuNames } from '../core/platform.ts'
import { scoredByCharacter } from '../core/language.ts'
import { sentenceKey, spellingsReader, type Spellings } from '../spellings/files.ts'
import { countAcceptedErrors } from './accepted.ts'
import { readResultFile } from './result-file/file.ts'
import { isDropped, type AsrRunRecord, type AudioPreparation, type HeardUtterance, type MemoryRecord, type ResultFile, type RunRecord, type SentenceRecord, type TtsRunRecord } from './result-file/format.ts'
import { countHeardErrors, heardAsSaid } from './heard.ts'
import { chunkGaps, leastAudioInHand } from './streaming.ts'
import { countErrors, type ErrorCount } from './scoring.ts'

/** What one speech recognition result file adds up to. */
export interface AsrSummary {
  run: AsrRunRecord
  utterances: number
  /** Utterances no model heard, for want of voice; the other figures leave them out. */
  dropped: number
  /** Errors over the utterances heard divided by their reference length, as the public benchmarks count them. */
  errorRate: number
  /** Utterances heard whose reference is annotated with its readings and accepted spellings. */
  annotated: number
  /** The error rate with the readings and accepted spellings, once every utterance heard is annotated, or null. */
  acceptedErrorRate: number | null
  empty: number
  /** The time to transcribe an utterance at the 50th, 90th and 99th percentiles. */
  latencySeconds: Percentiles
  /** RTFx: the summed audio duration over the summed transcription time, larger being faster. */
  inverseRealTimeFactor: number
}

/** What one speech synthesis result file adds up to. */
export interface TtsSummary {
  run: TtsRunRecord
  sentences: number
  /** What the recognizer misheard in the synthesized speech, over the whole set, each sentence counting at most all of its characters. */
  errorRate: number
  /** The same of the second recognizer, of another family, or null for a run without one. */
  secondErrorRate: number | null
  /**
   * The heard error rate of each kind of sentence the prompts name (short answers, numbers, mixed English and the
   * like), in the order the kinds first come.
   */
  errorRateByKind: Array<{ kind: string; sentences: number; errorRate: number }>
  /** The sentences the recognizer heard as they were written, apart from how it spells them. */
  heardAsSaid: number
  /** The time to the first audio of a sentence at the 50th, 90th and 99th percentiles. */
  firstAudioSeconds: Percentiles
  /** RTFx: the summed duration of the speech over the summed synthesis time, larger being faster. */
  inverseRealTimeFactor: number
  /** Seconds of speech per character of text, which shows speech that runs on or rushes. */
  secondsPerCharacter: number
  /**
   * How the audio of the sentences that came in more than one piece arrived; `whole` when every sentence came in one,
   * and null when the run did not record the pieces.
   */
  streaming: Streaming | 'whole' | null
}

/** How streamed audio arrived over a set of sentences. */
export interface Streaming {
  /** The time between two pieces of a sentence's audio. */
  interChunkSeconds: Percentiles
  /** The least audio a player held over the set as a later piece arrived; below zero the playback stopped. */
  leastAudioInHandSeconds: number
}

export type Summary = AsrSummary | TtsSummary

/** A latency at the percentiles it is reported at. */
export interface Percentiles {
  p50: number
  p90: number
  p99: number
}

const quantile = (sorted: readonly number[], share: number): number =>
  sorted.length === 0 ? Number.NaN : sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)] ?? Number.NaN

/** The percentiles of a set of times by the nearest rank, so that each is a time that was measured. */
export function percentiles(values: readonly number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b)
  return { p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), p99: quantile(sorted, 0.99) }
}

const sum = <T>(items: readonly T[], pick: (item: T) => number): number => items.reduce((total, item) => total + pick(item), 0)

/**
 * The errors of a set over the length of its references. They are counted here, from the texts a result
 * file keeps, so that every result is scored by the same rules however old it is.
 */
const corpusErrorRate = (counts: readonly ErrorCount[]): number => sum(counts, (count) => count.errors) / sum(counts, (count) => count.referenceLength)

/**
 * The error rate of the utterances heard with the readings and accepted spellings of their references, and how
 * many are annotated. A rate over part of a set would not compare with the plain one, so it waits for all of it.
 */
function accepted(heard: readonly HeardUtterance[], locale: string, spellingsOf: (locale: string) => Spellings): { annotated: number; acceptedErrorRate: number | null } {
  if (!scoredByCharacter(locale)) return { annotated: 0, acceptedErrorRate: null }
  const spellings = spellingsOf(locale)
  const counts = heard.flatMap((record) => {
    const sentence = spellings.get(sentenceKey(record.reference))
    return sentence ? [countAcceptedErrors(sentence.reference, sentence.segments, record.text)] : []
  })
  return { annotated: counts.length, acceptedErrorRate: counts.length === heard.length && heard.length > 0 ? corpusErrorRate(counts) : null }
}

/** How the audio of the sentences that recorded their pieces and came in more than one arrived. */
function streamingOf(sentences: readonly SentenceRecord[]): TtsSummary['streaming'] {
  if (sentences.some(({ chunks }) => chunks === null)) return null
  const streamed = sentences.flatMap(({ chunks }) => (chunks!.length > 1 ? [chunks!] : []))
  if (streamed.length === 0) return 'whole'
  return { interChunkSeconds: percentiles(streamed.flatMap(chunkGaps)), leastAudioInHandSeconds: Math.min(...streamed.map((chunks) => leastAudioInHand(chunks)!)) }
}

/** What a result file adds up to, its errors counted from its texts with the annotations `spellingsOf` reads. */
export function summarize(file: ResultFile, spellingsOf: (locale: string) => Spellings): Summary {
  if ('utterances' in file) {
    const { run, utterances } = file
    const heard = utterances.filter((record): record is HeardUtterance => !isDropped(record))
    return {
      run,
      utterances: utterances.length,
      dropped: utterances.length - heard.length,
      errorRate: corpusErrorRate(heard.map((record) => countErrors(record.reference, record.text, run.set.locale))),
      ...accepted(heard, run.set.locale, spellingsOf),
      empty: heard.filter((record) => record.text.trim() === '').length,
      latencySeconds: percentiles(heard.map((record) => record.seconds)),
      inverseRealTimeFactor: sum(heard, (record) => record.audioSeconds) / sum(heard, (record) => record.seconds)
    }
  }
  const { run, sentences } = file
  const counts = sentences.map((record) => countHeardErrors(record.text, record.transcript, run.set.locale))
  return {
    run,
    sentences: sentences.length,
    errorRate: corpusErrorRate(counts),
    secondErrorRate: run.secondRecognizer === null
      ? null
      : corpusErrorRate(sentences.map((record) => {
        if (record.secondTranscript === null) throw new Error(`sentence ${record.id} has no transcript of ${run.secondRecognizer!.id}, which its run names`)
        return countHeardErrors(record.text, record.secondTranscript, run.set.locale)
      })),
    errorRateByKind: [...new Set(sentences.map((record) => record.kind))].map((kind) => ({
      kind,
      sentences: sentences.filter((record) => record.kind === kind).length,
      errorRate: corpusErrorRate(counts.filter((_, index) => sentences[index]!.kind === kind))
    })),
    heardAsSaid: sentences.filter((record) => heardAsSaid(record.text, record.transcript, run.set.locale)).length,
    firstAudioSeconds: percentiles(sentences.map((record) => record.firstAudioSeconds)),
    inverseRealTimeFactor: sum(sentences, (record) => record.audioSeconds) / sum(sentences, (record) => record.totalSeconds),
    secondsPerCharacter: sum(sentences, (record) => record.audioSeconds) / sum(sentences, (record) => [...record.text].length),
    streaming: streamingOf(sentences)
  }
}

export function readSummaries(files: readonly string[]): Summary[] {
  const spellingsOf = spellingsReader()
  return files.map((file) => summarize(readResultFile(file), spellingsOf))
}


/** How the audio of a recognition run was prepared, in words. */
export function describeAudio(audio: AudioPreparation): string {
  if (audio.edges === 'voice') return `trimmed to the voice ${audio.detector} finds, with ${audio.marginSeconds} s around it`
  if (audio.edges === 'as-recorded') return `as recorded, ${audio.trailingSilence} s of silence added`
  return `cut by an energy VAD, hangover ${audio.hangoverMs} ms`
}

/**
 * The runtime of a run in words, with the commit of a build that ran in place of the release and where it was built,
 * the CI run among them, so that its run is taken neither for the release's nor for another build's of the commit.
 */
export const describeRuntime = ({ id, version, build }: RunRecord['runtime']): string => {
  if (build === null) return `${id} ${version}`
  const commit = build.commit.slice(0, 12)
  return build.ciRun === null ? `${id} ${version}, local build ${commit}` : `${id} ${version}, CI build ${commit} (run ${build.ciRun})`
}

/** The GPU the models ran on, which on a Mac is the chip that also names the CPU. */
const machineOf = (summary: Summary): string => `${gpuNames(summary.run.machine)}, ${summary.run.machine.os}`
const runtimeOf = (summary: Summary): string => {
  const options = Object.entries(summary.run.runtime.options).map(([name, value]) => `${name}=${value}`)
  return `${describeRuntime(summary.run.runtime)}${options.length > 0 ? ` (${options.join(', ')})` : ''}`
}
const percent = (rate: number): string => `${(rate * 100).toFixed(2)}%`

/**
 * What each measure of GPU memory is called: the dedicated memory of a discrete GPU is its VRAM, counted for the
 * runtime's processes on Windows and for the whole GPU on Linux, and a Mac's GPU shares its memory with the CPU, so that
 * what Metal's driver allocated is named for Metal.
 */
export const GPU_MEMORY_NAMES: Record<NonNullable<MemoryRecord['gpu']>['measure'], string> = { dedicated: 'VRAM', device: 'VRAM (whole GPU)', metal: 'GPU memory (Metal)' }

const gib = (bytes: number): string => (bytes / 1024 ** 3).toFixed(2)

/** The name of the GPU memory column, from the measures of the rows. */
function gpuMemoryHeader(rows: readonly Summary[]): string {
  const measures = new Set(rows.flatMap(({ run }) => (run.memory?.gpu ? [run.memory.gpu.measure] : [])))
  const names = (measures.size > 0 ? [...measures] : Object.keys(GPU_MEMORY_NAMES) as Array<keyof typeof GPU_MEMORY_NAMES>).map((measure) => GPU_MEMORY_NAMES[measure])
  return `${names.join(' or ')} GiB`
}

/** The resident and the Metal memory of a Mac run together, and whether the figure is only an upper bound. */
export interface UnifiedMemory {
  bytes: number
  upperBound: boolean
}

/**
 * What a runtime held of a Mac's memory, which its CPU and GPU share: the resident and the Metal memory together, since
 * ggml's buffers count as resident and those Metal allocates for PyTorch or MLX as Metal memory. A run before the peak
 * of their sum was recorded gives the sum of the two peaks, an upper bound, as they may come from different samples.
 * Null where memory was not measured, and on Windows, where the resident memory and VRAM are different memories.
 */
export function unifiedMemoryOf(memory: MemoryRecord | null): UnifiedMemory | null {
  if (memory?.gpu?.measure !== 'metal') return null
  const { peakBytes, peakTotalBytes } = memory.gpu
  return peakTotalBytes === null ? { bytes: memory.peakResidentBytes + peakBytes, upperBound: true } : { bytes: peakTotalBytes, upperBound: false }
}

const UNIFIED_MEMORY_HEADER = 'Memory (RSS + Metal) GiB'

/**
 * The columns of what the runtime cost besides its speed, which every run has: its load time, its first request after
 * loading, which pays for the GPU's first use, its memory and the GPU's power. A run made before one was measured
 * says so, and a machine that does not have it says none.
 */
function runtimeColumns(rows: readonly Summary[]): Array<[string, (run: RunRecord) => string]> {
  const unified: Array<[string, (run: RunRecord) => string]> = rows.some(({ run }) => run.memory?.gpu?.measure === 'metal')
    ? [[UNIFIED_MEMORY_HEADER, ({ memory }) => {
      const unifiedMemory = unifiedMemoryOf(memory)
      if (unifiedMemory === null) return memory === null ? 'not measured' : '—'
      return `${unifiedMemory.upperBound ? '≤ ' : ''}${gib(unifiedMemory.bytes)}`
    }]]
    : []
  return [
    ['Load s', (run) => `${run.loadSeconds.toFixed(1)}${run.coldLoad ? ' cold' : ''}`],
    ['First request s', (run) => run.warmupSeconds.toFixed(3)],
    ['Peak memory GiB', ({ memory }) => (memory === null ? 'not measured' : gib(memory.peakResidentBytes))],
    [gpuMemoryHeader(rows), ({ memory }) => (memory === null ? 'not measured' : memory.gpu === null ? 'none' : gib(memory.gpu.peakBytes))],
    ...unified,
    ['GPU power W, peak / mean', ({ gpuPower, load }) => (gpuPower !== null ? `${gpuPower.peakWatts.toFixed(0)} / ${gpuPower.meanWatts.toFixed(0)}` : load === null ? 'not measured' : 'none')]
  ]
}

/** What a memory written `≤` is, below a table that has one. */
const unifiedMemoryNote = (rows: readonly Summary[]): string[] =>
  rows.some(({ run }) => unifiedMemoryOf(run.memory)?.upperBound)
    ? ['', `${UNIFIED_MEMORY_HEADER} written ≤ is the sum of the two peaks, which may come from different samples, for a run made before the peak of their sum was recorded.`]
    : []

/** A Markdown table of `rows`, each column a header and how to write a row's cell. */
function table<R>(rows: readonly R[], columns: ReadonlyArray<[string, (row: R) => string | number]>): string[] {
  const line = (cells: ReadonlyArray<string | number>): string => `| ${cells.join(' | ')} |`
  return [line(columns.map(([header]) => header)), `|${columns.map(() => '---|').join('')}`, ...rows.map((row) => line(columns.map(([, cell]) => cell(row))))]
}

/** The rate with accepted spellings, or how many of the utterances heard are annotated while some are not. */
const acceptedCell = (row: AsrSummary): string =>
  row.acceptedErrorRate === null ? `${row.annotated} of ${row.utterances - row.dropped} annotated` : percent(row.acceptedErrorRate)

function asrTable(rows: readonly AsrSummary[]): string[] {
  const byCharacter = scoredByCharacter(rows[0]!.run.set.locale)
  const metric = byCharacter ? 'CER' : 'WER'
  return table<AsrSummary>(rows, [
    ['Model', (row) => row.run.model.label],
    ['GPU, system', machineOf],
    ['Runtime', runtimeOf],
    ['N', (row) => row.utterances],
    ['Dropped by VAD', (row) => row.dropped],
    [metric, (row) => percent(row.errorRate)],
    ...(byCharacter ? [['CER, accepted spellings', acceptedCell] as [string, (row: AsrSummary) => string]] : []),
    ['Empty', (row) => row.empty],
    ...percentileColumns<AsrSummary>('', (row) => row.latencySeconds),
    ['RTFx', (row) => row.inverseRealTimeFactor.toFixed(1)],
    ...runtimeColumns(rows).map(([header, cell]): [string, (row: AsrSummary) => string] => [header, (row) => cell(row.run)])
  ])
}

/** The columns of a latency at p50, p90 and p99, named after `what` it is the time to. */
const percentileColumns = <R>(what: string, of: (row: R) => Percentiles): Array<[string, (row: R) => string]> =>
  (['p50', 'p90', 'p99'] as const).map((rank) => [`${rank}${what} s`, (row) => of(row)[rank].toFixed(3)])

const voiceDescription = ({ run }: TtsSummary): string =>
  [run.design?.id, run.reference ? `reference ${run.reference.name}` : null, run.durationScale === null ? null : `length ×${run.durationScale}`].filter(Boolean).join(' + ') || 'none'

/** Why a run has no figures of streaming: its sentences came whole, or it did not record their pieces. */
const streamingAbsent = (streaming: 'whole' | null): string => streaming ?? 'not recorded'

/** The header of the second recognizer's column, named by the recognizers of the rows. */
function secondHeader(rows: readonly TtsSummary[], metric: string): string {
  const labels = [...new Set(rows.flatMap(({ run }) => (run.secondRecognizer === null ? [] : [run.secondRecognizer.label])))]
  return `Heard ${metric}, ${labels.length > 0 ? labels.join(' or ') : 'second recognizer'}`
}

function ttsTable(rows: readonly TtsSummary[]): string[] {
  const metric = scoredByCharacter(rows[0]!.run.set.locale) ? 'CER' : 'WER'
  return table<TtsSummary>(rows, [
    ['Model', (row) => row.run.model.label],
    ['Voice', (row) => row.run.voice ?? 'none'],
    ['Design or reference', voiceDescription],
    ['Seed', (row) => row.run.seed ?? 'random'],
    ['GPU, system', machineOf],
    ['Runtime', runtimeOf],
    ['N', (row) => row.sentences],
    [`Heard ${metric}`, (row) => percent(row.errorRate)],
    [secondHeader(rows, metric), (row) => (row.secondErrorRate === null ? '—' : percent(row.secondErrorRate))],
    ['Heard as said', (row) => row.heardAsSaid],
    ...percentileColumns<TtsSummary>(' first audio', (row) => row.firstAudioSeconds),
    ['RTFx', (row) => row.inverseRealTimeFactor.toFixed(2)],
    ['s per character', (row) => row.secondsPerCharacter.toFixed(3)],
    ['Inter-chunk s, p50 / p90 / p99', ({ streaming }) => (typeof streaming === 'object' && streaming !== null ? (['p50', 'p90', 'p99'] as const).map((rank) => streaming.interChunkSeconds[rank].toFixed(3)).join(' / ') : streamingAbsent(streaming))],
    ['Least audio in hand s', ({ streaming }) => (typeof streaming === 'object' && streaming !== null ? streaming.leastAudioInHandSeconds.toFixed(3) : streamingAbsent(streaming))],
    ...runtimeColumns(rows).map(([header, cell]): [string, (row: TtsSummary) => string] => [header, (row) => cell(row.run)])
  ])
}

/** The heard error rate of each kind of sentence, a column a kind with how many sentences it has in the first run. */
function kindTable(rows: readonly TtsSummary[]): string[] {
  const kinds = [...new Set(rows.flatMap((row) => row.errorRateByKind.map(({ kind }) => kind)))]
  return table<TtsSummary>(rows, [
    ['Model', (row) => row.run.model.label],
    ['Seed', (row) => row.run.seed ?? 'random'],
    ['Runtime', runtimeOf],
    ...kinds.map((kind): [string, (row: TtsSummary) => string] => {
      const sentences = rows[0]!.errorRateByKind.find((entry) => entry.kind === kind)?.sentences
      return [`${kind}${sentences === undefined ? '' : ` (${sentences})`}`, (row) => {
        const entry = row.errorRateByKind.find((candidate) => candidate.kind === kind)
        return entry === undefined ? '—' : percent(entry.errorRate)
      }]
    })
  ])
}

/** A Markdown table per set and way of measuring, one row per model and machine, in the order the runs were made. */
export function formatReport(summaries: readonly Summary[]): string {
  const groups = new Map<string, Summary[]>()
  for (const summary of summaries) {
    const { run } = summary
    const key = run.task === 'asr'
      ? `Speech recognition: ${run.set.name} (${run.set.locale}), ${describeAudio(run.audio)}`
      : `Speech synthesis: ${run.set.name} (${run.set.locale}), heard by ${run.recognizer.label}`
    groups.set(key, [...(groups.get(key) ?? []), summary])
  }
  return [...groups.entries()].map(([title, rows]) => {
    const table = rows[0]!.run.task === 'asr'
      ? [...asrTable(rows as AsrSummary[]), ...unifiedMemoryNote(rows)]
      : [...ttsTable(rows as TtsSummary[]), ...unifiedMemoryNote(rows), '', `Heard ${scoredByCharacter(rows[0]!.run.set.locale) ? 'CER' : 'WER'} by kind of sentence:`, '', ...kindTable(rows as TtsSummary[])]
    return [`## ${title}`, '', ...table].join('\n')
  }).join('\n\n')
}
