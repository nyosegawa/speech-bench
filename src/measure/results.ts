import type { MachineInfo } from '../core/platform.ts'

/**
 * The version of the form of a result file, written in its run line. Raising it needs an upgrade in
 * `upgradeRun` and a sample of the new version in tests/fixtures.
 */
export const RESULT_FORMAT = 11

/**
 * How the audio of each utterance is prepared before it is sent to speech recognition: trimmed to the voice
 * a VAD finds with a margin of the recording around it, or as recorded with silence added after it. Runs of
 * formats 2 to 10 were cut the way ASIST's energy VAD cuts a capture, keeping a hangover after it.
 */
export type AudioPreparation = NewPreparation | { edges: 'asist'; hangoverMs: number }

/** The preparations a run can be made with now. */
export type NewPreparation =
  | { edges: 'voice'; detector: string; marginSeconds: number }
  | { edges: 'as-recorded'; trailingSilence: number }

/** The pinned files a run used, so that a result names exactly what it measured. */
export interface ModelRecord {
  id: string
  label: string
  license: string
  files: Array<{ repo: string; revision: string; file: string; sha256: string }>
}

interface RunCommon {
  type: 'run'
  format: typeof RESULT_FORMAT
  startedAt: string
  machine: MachineInfo
  set: { name: string; locale: string; size: number }
  model: ModelRecord
  /** The runtime and the options it was loaded with, which can change what it produces. */
  runtime: { id: string; version: string; options: Readonly<Record<string, string>> }
  /** From starting the process to its being ready: loading the model and, on the first run, compiling GPU kernels. */
  loadSeconds: number
  /** The first item, repeated untimed because it pays for the GPU's first use. */
  warmupSeconds: number
}

/** The first line of a speech recognition result file. */
export interface AsrRunRecord extends RunCommon {
  task: 'asr'
  audio: AudioPreparation
}

/** An utterance the model transcribed. */
export interface HeardUtterance {
  type: 'utterance'
  id: string
  audioSeconds: number
  reference: string
  text: string
  seconds: number
}

/**
 * An utterance no model heard: one in which the VAD found no voice, or, in runs of formats 5 to 10, one
 * ASIST's energy VAD kept nothing of.
 */
export interface DroppedUtterance {
  type: 'utterance'
  id: string
  reference: string
  droppedBy: 'no-voice' | 'asist-vad'
}

/** One line per utterance after an ASR run line. */
export type UtteranceRecord = HeardUtterance | DroppedUtterance

export const isDropped = (record: UtteranceRecord): record is DroppedUtterance => 'droppedBy' in record

/** The first line of a speech synthesis result file. */
export interface TtsRunRecord extends RunCommon {
  task: 'tts'
  /** The built-in voice, or null for a model that has none. */
  voice: string | null
  /** The seed every sentence was sampled with, or null when the runtime chose one for each sentence. */
  seed: number | null
  /** The voice described in words for a model without built-in voices, or null. */
  design: { id: string; instruction: string } | null
  /** The reference voice the model spoke like, by name and the sha256 of its WAVE file, or null. */
  reference: { name: string; sha256: string; seconds: number } | null
  /** What the length the model predicted for each sentence was multiplied by, or null when it was left as predicted. */
  durationScale: number | null
  /** The speech recognition model the synthesized audio is transcribed with, to count what it misread. */
  recognizer: { id: string; label: string }
}

/** One line per sentence after a TTS run line. */
export interface SentenceRecord {
  type: 'sentence'
  id: string
  kind: string
  text: string
  /** The WAVE file of the speech, in the folder named after the result file without its extension. */
  audio: string
  audioSeconds: number
  firstAudioSeconds: number
  totalSeconds: number
  /** What the recognizer heard. */
  transcript: string
}

export type RunRecord = AsrRunRecord | TtsRunRecord

/**
 * Brings a run line of an earlier format to the current one. Format 1 sent every utterance as recorded,
 * with `trailingSilence` seconds after it; formats 1 and 2 held speech recognition runs only; formats 1 to 3
 * stored the errors of each record, which are now counted when reporting and are left unread; formats 1 to
 * 4 had no dropped utterances, since a run stopped at an utterance ASIST's VAD dropped; formats 3 to 5 set no
 * seed for speech synthesis, so the runtime chose one for each sentence; formats 3 to 6 described no voice;
 * formats 1 to 7 loaded every runtime with its defaults, which on Metal ran Irodori-TTS's codec on the GPU;
 * formats 3 to 8 had no reference voice; formats 3 to 9 left the length of the speech as the model predicted it;
 * formats 2 to 10 knew no other preparation than ASIST's and as recorded.
 */
export function upgradeRun(raw: Record<string, unknown>): RunRecord {
  let run = raw
  if (run.format === 1) {
    const { trailingSilence, ...rest } = run
    run = { ...rest, format: 2, audio: { edges: 'as-recorded', trailingSilence } }
  }
  if (run.format === 2) run = { ...run, format: 3, task: 'asr' }
  if (run.format === 3) run = { ...run, format: 4 }
  if (run.format === 4) run = { ...run, format: 5 }
  if (run.format === 5) run = { ...run, format: 6, ...(run.task === 'tts' ? { seed: null } : {}) }
  if (run.format === 6) run = { ...run, format: 7, ...(run.task === 'tts' ? { design: null } : {}) }
  if (run.format === 7) run = { ...run, format: 8, runtime: { ...(run.runtime as Record<string, unknown>), options: {} } }
  if (run.format === 8) run = { ...run, format: 9, ...(run.task === 'tts' ? { reference: null } : {}) }
  if (run.format === 9) run = { ...run, format: 10, ...(run.task === 'tts' ? { durationScale: null } : {}) }
  if (run.format === 10) run = { ...run, format: 11 }
  if (run.format !== RESULT_FORMAT) throw new Error(`result format ${String(run.format)} is not known; this version reads formats 1 to ${RESULT_FORMAT}`)
  return run as unknown as RunRecord
}

/** A result file as its run line and the records after it. */
export type ResultFile =
  | { run: AsrRunRecord; utterances: UtteranceRecord[] }
  | { run: TtsRunRecord; sentences: SentenceRecord[] }

export function parseResultFile(lines: readonly string[]): ResultFile {
  const records = lines.filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as Record<string, unknown>)
  const first = records.find((record) => record.type === 'run')
  if (!first) throw new Error('a result file starts with a run line')
  const run = upgradeRun(first)
  if (run.task === 'asr') return { run, utterances: records.filter((record) => record.type === 'utterance') as unknown as UtteranceRecord[] }
  return { run, sentences: records.filter((record) => record.type === 'sentence') as unknown as SentenceRecord[] }
}
