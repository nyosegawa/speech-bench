import type { Pcm } from '../wav.ts'

/** One synthesized sentence and its timing: from sending the text to the first audio, and to the last. */
export interface Synthesis {
  pcm: Pcm
  firstAudioSeconds: number
  totalSeconds: number
}

/** A speech synthesis model running in a process of its own. */
export interface TtsEngine {
  start(): Promise<void>
  /** `voice` is null for a model without built-in voices. */
  synthesize(text: string, locale: string, voice: string | null): Promise<Synthesis>
  stop(): Promise<void>
  /** The process's log file, for the report of a failure. */
  readonly log: string | null
}
