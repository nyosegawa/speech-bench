import type { Pcm } from '../core/wav.ts'

/** A piece of audio as it arrived: when, in seconds from sending the text, and how many seconds of speech it held. */
export interface ArrivedChunk {
  seconds: number
  audioSeconds: number
}

/** One synthesized sentence and its timing: from sending the text to the first audio, and to the last. */
export interface Synthesis {
  pcm: Pcm
  firstAudioSeconds: number
  totalSeconds: number
  /** The audio in the pieces it arrived in, one for a runtime that answers with the whole sentence. */
  chunks: ArrivedChunk[]
}

/** A speech synthesis model running in a process of its own. */
export interface TtsEngine {
  start(): Promise<void>
  /** `voice` is null for a model without built-in voices. */
  synthesize(text: string, locale: string, voice: string | null): Promise<Synthesis>
  stop(): Promise<void>
  /** The process's log file, for the report of a failure. */
  readonly log: string | null
  /** The process the engine started, once it is started, whose processes the bench measures the memory of. */
  readonly pid: number | null
}
