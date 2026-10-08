import { z } from 'zod'
import { currentVersion } from '../../core/stored.ts'
import { resultUpgrades } from './upgrades/index.ts'

/**
 * The version of the form of a result file, `format` in its run line. A change to the form, an added field
 * included, adds a step to `upgrades/` and a sample of the new version to tests/fixtures/result-file.
 */
export const RESULT_FORMAT = currentVersion(resultUpgrades)

/** The preparations a run can be made with now. */
const newPreparations = [
  z.strictObject({ edges: z.literal('voice'), detector: z.string(), marginSeconds: z.number() }),
  z.strictObject({ edges: z.literal('as-recorded'), trailingSilence: z.number() })
] as const
export type NewPreparation = z.infer<(typeof newPreparations)[number]>

/**
 * How the audio of each utterance is prepared before it is sent to speech recognition: trimmed to the voice
 * a VAD finds with a margin of the recording around it, or as recorded with silence added after it. Runs made
 * until 2026-09-30 were cut by an energy VAD that kept a hangover after the voice, which the bench no longer does.
 */
const audioPreparation = z.discriminatedUnion('edges', [...newPreparations, z.strictObject({ edges: z.literal('energy-vad'), hangoverMs: z.number() })])
export type AudioPreparation = z.infer<typeof audioPreparation>

/** A file downloaded from Hugging Face, or made from a checkpoint there. */
const publishedFile = z.strictObject({
  source: z.literal('huggingface'),
  repo: z.string(),
  revision: z.string(),
  file: z.string(),
  sha256: z.string(),
  /**
   * The converter that made the file from the checkpoint at `repo` and `revision`, at its commit with its arguments,
   * or null for a file downloaded from there as it is.
   */
  converter: z.strictObject({ repository: z.string(), commit: z.string(), args: z.array(z.string()) }).nullable().default(null)
})

/** A file on the machine that was not published, run in place of an entry's pinned file. */
const localFile = z.strictObject({ source: z.literal('local'), file: z.string(), bytes: z.int(), sha256: z.string() })

/** The files a run used, so that a result names exactly what it measured. */
const modelRecord = z.strictObject({
  id: z.string(),
  label: z.string(),
  license: z.string(),
  files: z.array(z.discriminatedUnion('source', [publishedFile, localFile]))
})
export type ModelRecord = z.infer<typeof modelRecord>

const runCommon = {
  type: z.literal('run'),
  format: z.literal(RESULT_FORMAT),
  startedAt: z.string(),
  machine: z.strictObject({
    platform: z.enum(['darwin-arm64', 'win32-x64']),
    hostname: z.string(),
    os: z.string(),
    cpu: z.string(),
    memoryGb: z.number(),
    gpus: z.array(z.string())
  }),
  set: z.strictObject({ name: z.string(), locale: z.string(), size: z.int() }),
  model: modelRecord,
  /** The runtime and the options it was loaded with, which can change what it produces. */
  runtime: z.strictObject({
    id: z.string(),
    /** The pinned release, or the release number a build that ran in place of it reports. */
    version: z.string(),
    /**
     * A build that ran in place of the release, by the commit it was built from and the run of speech.cpp's CI that
     * built it, null for one built on the machine; null for the release.
     */
    build: z.strictObject({ commit: z.string(), ciRun: z.int().nullable() }).nullable(),
    options: z.record(z.string(), z.string())
  }),
  /** From starting the process to its being ready: loading the model and, on the first run, compiling GPU kernels. */
  loadSeconds: z.number(),
  /** The first item, repeated untimed because it pays for the GPU's first use. */
  warmupSeconds: z.number()
}

/** The first line of a speech recognition result file. */
const asrRunRecord = z.strictObject({ ...runCommon, task: z.literal('asr'), audio: audioPreparation })
export type AsrRunRecord = z.infer<typeof asrRunRecord>

/** The first line of a speech synthesis result file. */
const ttsRunRecord = z.strictObject({
  ...runCommon,
  task: z.literal('tts'),
  /** The built-in voice, or null for a model that has none. */
  voice: z.string().nullable(),
  /** The seed every sentence was sampled with, or null when the runtime chose one for each sentence. */
  seed: z.int().nullable(),
  /** The voice described in words for a model without built-in voices, or null. */
  design: z.strictObject({ id: z.string(), instruction: z.string() }).nullable(),
  /** The reference voice the model spoke like, by name and the sha256 of its WAVE file, or null. */
  reference: z.strictObject({ name: z.string(), sha256: z.string(), seconds: z.number() }).nullable(),
  /** What the length the model predicted for each sentence was multiplied by, or null when it was left as predicted. */
  durationScale: z.number().nullable(),
  /** The speech recognition model the synthesized audio is transcribed with, to count what it misread. */
  recognizer: z.strictObject({ id: z.string(), label: z.string() })
})
export type TtsRunRecord = z.infer<typeof ttsRunRecord>

/** The first line of a result file. */
export const runRecord = z.discriminatedUnion('task', [asrRunRecord, ttsRunRecord])
export type RunRecord = z.infer<typeof runRecord>

/** An utterance the model transcribed. */
export const heardUtterance = z.strictObject({
  type: z.literal('utterance'),
  id: z.string(),
  audioSeconds: z.number(),
  reference: z.string(),
  text: z.string(),
  seconds: z.number()
})
export type HeardUtterance = z.infer<typeof heardUtterance>

/** An utterance no model heard: one in which the VAD found no voice, or one the energy VAD kept nothing of. */
export const droppedUtterance = z.strictObject({
  type: z.literal('utterance'),
  id: z.string(),
  reference: z.string(),
  droppedBy: z.enum(['no-voice', 'energy-vad'])
})
export type DroppedUtterance = z.infer<typeof droppedUtterance>

/** One line per utterance after an ASR run line. */
export type UtteranceRecord = HeardUtterance | DroppedUtterance

export const isDropped = (record: UtteranceRecord): record is DroppedUtterance => 'droppedBy' in record

/** One line per sentence after a TTS run line. */
export const sentenceRecord = z.strictObject({
  type: z.literal('sentence'),
  id: z.string(),
  kind: z.string(),
  text: z.string(),
  /** The WAVE file of the speech, in the folder of the run. */
  audio: z.string(),
  audioSeconds: z.number(),
  firstAudioSeconds: z.number(),
  totalSeconds: z.number(),
  /** What the recognizer heard. */
  transcript: z.string()
})
export type SentenceRecord = z.infer<typeof sentenceRecord>

/** A result file as its run line and the records after it. */
export type ResultFile =
  | { run: AsrRunRecord; utterances: UtteranceRecord[] }
  | { run: TtsRunRecord; sentences: SentenceRecord[] }
