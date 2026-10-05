import type { MachineInfo } from '../core/platform.ts'

/**
 * The version of the form of a result file, written in its run line. A file of another version is refused;
 * raising it means rewriting the data folder's results to the new form and a sample of it in tests/fixtures.
 */
export const RESULT_FORMAT = 12

/**
 * How the audio of each utterance is prepared before it is sent to speech recognition: trimmed to the voice
 * a VAD finds with a margin of the recording around it, or as recorded with silence added after it. Runs made
 * until 2026-09-30 were cut by an energy VAD that kept a hangover after the voice, which the bench no longer does.
 */
export type AudioPreparation = NewPreparation | { edges: 'energy-vad'; hangoverMs: number }

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

/** An utterance no model heard: one in which the VAD found no voice, or one the energy VAD kept nothing of. */
export interface DroppedUtterance {
  type: 'utterance'
  id: string
  reference: string
  droppedBy: 'no-voice' | 'energy-vad'
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

/** A result file as its run line and the records after it. */
export type ResultFile =
  | { run: AsrRunRecord; utterances: UtteranceRecord[] }
  | { run: TtsRunRecord; sentences: SentenceRecord[] }

export function parseResultFile(lines: readonly string[]): ResultFile {
  const records = lines.filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as Record<string, unknown>)
  const first = records.find((record) => record.type === 'run')
  if (!first) throw new Error('a result file starts with a run line')
  if (first.format !== RESULT_FORMAT) throw new Error(`the result file is of format ${String(first.format)}, and this version reads format ${RESULT_FORMAT} only`)
  const run = first as unknown as RunRecord
  if (run.task === 'asr') return { run, utterances: records.filter((record) => record.type === 'utterance') as unknown as UtteranceRecord[] }
  return { run, sentences: records.filter((record) => record.type === 'sentence') as unknown as SentenceRecord[] }
}
