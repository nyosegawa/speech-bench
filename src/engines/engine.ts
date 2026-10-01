import type { Pcm } from '../wav.ts'

/** One transcription and the wall time from sending the whole utterance to receiving the text. */
export interface Transcription {
  text: string
  seconds: number
}

/**
 * A speech recognition model running in a server of its own. The utterance is sent whole, as an application
 * sends it once its VAD has closed the utterance, so the measured time is the wait after the speaker stops.
 */
export interface AsrEngine {
  start(): Promise<void>
  /** `locale` is passed only to models that can be told the language. */
  transcribe(pcm: Pcm, locale: string): Promise<Transcription>
  stop(): Promise<void>
  /** The server's log file, for the report of a failure. */
  readonly log: string | null
}
