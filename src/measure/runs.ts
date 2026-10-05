import fs from 'node:fs'
import path from 'node:path'
import { runsDir } from '../core/paths.ts'
import type { SentenceRecord } from './result-file/format.ts'

/**
 * Where runs are kept: a folder per run, named by the run, holding its result file `run.jsonl`, for synthesis
 * the WAVE file of each sentence, and `analysis.json`, what was read from that speech, which can always be
 * made again. A run's folder is its whole record, so that moving or removing a run moves or removes all of it.
 */
export const RESULT_FILE = 'run.jsonl'

export const runFolder = (id: string): string => path.join(runsDir(), id)
export const runFile = (id: string): string => path.join(runFolder(id), RESULT_FILE)
/** A run's name, from the path of its result file. */
export const runIdOf = (file: string): string => path.basename(path.dirname(file))
/** The WAVE file of a synthesized sentence, beside the result file of its run. */
export const takeFile = (file: string, record: SentenceRecord): string => path.join(path.dirname(file), record.audio)

/** The result file of every run, in the order of their names, which begin with the task and the time. */
export function allRunFiles(): string[] {
  if (!fs.existsSync(runsDir())) return []
  return fs.readdirSync(runsDir()).sort().map(runFile).filter((file) => fs.existsSync(file))
}
