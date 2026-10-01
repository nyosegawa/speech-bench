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
/** The result files of format 1 to 11 before runs had folders of their own; `migrate` moves them into runs/. */
export const resultsDir = (): string => path.join(dataDir(), 'results')
/** One folder per run: its result file and, for synthesis, the speech. */
export const runsDir = (): string => path.join(dataDir(), 'runs')
/** Named groups of runs, one experiment each. */
export const campaignsDir = (): string => path.join(dataDir(), 'campaigns')
/** The pages the listen, neighbors and voices commands write. */
/** Reference voices made from sets of synthesized takes, a WAVE file and its manifest each. */
export const referencesDir = (): string => path.join(dataDir(), 'references')
/** Irodori-TTS voice files made from reference voices, kept by the reference and the codec they encode. */
export const voiceFilesDir = (): string => path.join(dataDir(), 'voice-files')
