import fs from 'node:fs'
import { scoredByCharacter } from '../core/language.ts'
import { sentenceKey, spellingsReader, type Spellings } from '../spellings/files.ts'
import { countAcceptedErrors } from './accepted.ts'
import { isDropped, parseResultFile, type AsrRunRecord, type AudioPreparation, type HeardUtterance, type TtsRunRecord } from './results.ts'
import { countHeardErrors, heardAsSaid } from './heard.ts'
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
  medianSeconds: number
  p90Seconds: number
  /** The summed transcription time over the summed audio duration. */
  realTimeFactor: number
}

/** What one speech synthesis result file adds up to. */
export interface TtsSummary {
  run: TtsRunRecord
  sentences: number
  /** What the recognizer misheard in the synthesized speech, over the whole set, each sentence counting at most all of its characters. */
  errorRate: number
  /** The sentences the recognizer heard as they were written, apart from how it spells them. */
  heardAsSaid: number
  medianFirstAudioSeconds: number
  p90FirstAudioSeconds: number
  /** The summed synthesis time over the summed duration of the speech. */
  realTimeFactor: number
  /** Seconds of speech per character of text, which shows speech that runs on or rushes. */
  secondsPerCharacter: number
}

export type Summary = AsrSummary | TtsSummary

const quantile = (values: readonly number[], share: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? Number.NaN : sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)] ?? Number.NaN
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

/** What a result file adds up to, its errors counted from its texts with the annotations `spellingsOf` reads. */
export function summarize(lines: readonly string[], spellingsOf: (locale: string) => Spellings): Summary {
  const file = parseResultFile(lines)
  if ('utterances' in file) {
    const { run, utterances } = file
    const heard = utterances.filter((record): record is HeardUtterance => !isDropped(record))
    const seconds = heard.map((record) => record.seconds)
    return {
      run,
      utterances: utterances.length,
      dropped: utterances.length - heard.length,
      errorRate: corpusErrorRate(heard.map((record) => countErrors(record.reference, record.text, run.set.locale))),
      ...accepted(heard, run.set.locale, spellingsOf),
      empty: heard.filter((record) => record.text.trim() === '').length,
      medianSeconds: quantile(seconds, 0.5),
      p90Seconds: quantile(seconds, 0.9),
      realTimeFactor: sum(heard, (record) => record.seconds) / sum(heard, (record) => record.audioSeconds)
    }
  }
  const { run, sentences } = file
  const firstAudio = sentences.map((record) => record.firstAudioSeconds)
  return {
    run,
    sentences: sentences.length,
    errorRate: corpusErrorRate(sentences.map((record) => countHeardErrors(record.text, record.transcript, run.set.locale))),
    heardAsSaid: sentences.filter((record) => heardAsSaid(record.text, record.transcript, run.set.locale)).length,
    medianFirstAudioSeconds: quantile(firstAudio, 0.5),
    p90FirstAudioSeconds: quantile(firstAudio, 0.9),
    realTimeFactor: sum(sentences, (record) => record.totalSeconds) / sum(sentences, (record) => record.audioSeconds),
    secondsPerCharacter: sum(sentences, (record) => record.audioSeconds) / sum(sentences, (record) => [...record.text].length)
  }
}

export function readSummaries(files: readonly string[]): Summary[] {
  const spellingsOf = spellingsReader()
  return files.map((file) => summarize(fs.readFileSync(file, 'utf8').split('\n'), spellingsOf))
}


/** How the audio of a recognition run was prepared, in words. */
export function describeAudio(audio: AudioPreparation): string {
  if (audio.edges === 'voice') return `trimmed to the voice ${audio.detector} finds, with ${audio.marginSeconds} s around it`
  if (audio.edges === 'as-recorded') return `as recorded, ${audio.trailingSilence} s of silence added`
  return `cut like ASIST's VAD, hangover ${audio.hangoverMs} ms`
}

/** The GPU the models ran on, which on a Mac is the chip that also names the CPU. */
const machineOf = (summary: Summary): string => `${summary.run.machine.gpus.join(' + ')}, ${summary.run.machine.os}`
const runtimeOf = (summary: Summary): string => {
  const options = Object.entries(summary.run.runtime.options).map(([name, value]) => `${name}=${value}`)
  return `${summary.run.runtime.id} ${summary.run.runtime.version}${options.length > 0 ? ` (${options.join(', ')})` : ''}`
}
const percent = (rate: number): string => `${(rate * 100).toFixed(2)}%`

/** The rate with accepted spellings, or how many of the utterances heard are annotated while some are not. */
const acceptedCell = (row: AsrSummary): string =>
  row.acceptedErrorRate === null ? `${row.annotated} of ${row.utterances - row.dropped} annotated` : percent(row.acceptedErrorRate)

function asrTable(rows: readonly AsrSummary[]): string[] {
  const byCharacter = scoredByCharacter(rows[0]!.run.set.locale)
  const metric = byCharacter ? 'CER' : 'WER'
  const accepted = byCharacter ? ' CER, accepted spellings |' : ''
  return [
    `| Model | GPU, system | Runtime | N | Dropped by VAD | ${metric} |${accepted} Empty | Median s | p90 s | RTF | Load s |`,
    `|---|---|---|---|---|---|${byCharacter ? '---|' : ''}---|---|---|---|---|`,
    ...rows.map((row) => `| ${[row.run.model.label, machineOf(row), runtimeOf(row), row.utterances, row.dropped, percent(row.errorRate),
      ...(byCharacter ? [acceptedCell(row)] : []), row.empty,
      row.medianSeconds.toFixed(3), row.p90Seconds.toFixed(3), row.realTimeFactor.toFixed(3), row.run.loadSeconds.toFixed(1)].join(' | ')} |`)
  ]
}

function ttsTable(rows: readonly TtsSummary[]): string[] {
  const metric = scoredByCharacter(rows[0]!.run.set.locale) ? 'CER' : 'WER'
  return [
    `| Model | Voice | Design or reference | Seed | GPU, system | Runtime | N | Heard ${metric} | Heard as said | Median first audio s | p90 first audio s | RTF | s per character | Load s |`,
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((row) => `| ${[row.run.model.label, row.run.voice ?? 'none', [row.run.design?.id, row.run.reference ? `reference ${row.run.reference.name}` : null, row.run.durationScale === null ? null : `length ×${row.run.durationScale}`].filter(Boolean).join(' + ') || 'none', row.run.seed ?? 'random', machineOf(row), runtimeOf(row), row.sentences, percent(row.errorRate), row.heardAsSaid,
      row.medianFirstAudioSeconds.toFixed(3), row.p90FirstAudioSeconds.toFixed(3), row.realTimeFactor.toFixed(3), row.secondsPerCharacter.toFixed(3),
      row.run.loadSeconds.toFixed(1)].join(' | ')} |`)
  ]
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
    const table = rows[0]!.run.task === 'asr' ? asrTable(rows as AsrSummary[]) : ttsTable(rows as TtsSummary[])
    return [`## ${title}`, '', ...table].join('\n')
  }).join('\n\n')
}
