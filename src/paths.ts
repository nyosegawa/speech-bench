import os from 'node:os'
import path from 'node:path'

/**
 * The folder for downloads, recordings, logs and results. It lies outside the repository so that no
 * recording of a voice is ever committed; SPEECH_BENCH_DATA moves it.
 */
export function dataDir(): string {
  const configured = process.env.SPEECH_BENCH_DATA?.trim()
  return configured ? path.resolve(configured) : path.join(os.homedir(), 'speech-bench-data')
}

export const runtimesDir = (): string => path.join(dataDir(), 'runtimes')
export const recordingsDir = (): string => path.join(dataDir(), 'recordings')
export const logsDir = (): string => path.join(dataDir(), 'logs')
export const resultsDir = (): string => path.join(dataDir(), 'results')
/** Reference voices made from sets of synthesized takes, a WAVE file and its manifest each. */
export const referencesDir = (): string => path.join(dataDir(), 'references')
/** Irodori-TTS voice files made from reference voices, kept by the reference and the codec they encode. */
export const voiceFilesDir = (): string => path.join(dataDir(), 'voice-files')
