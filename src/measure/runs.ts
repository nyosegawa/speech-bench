import fs from 'node:fs'
import path from 'node:path'
import { resultsDir, runsDir } from '../core/paths.ts'
import type { SentenceRecord } from './results.ts'

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

/**
 * Moves the result files of the earlier layout, `results/<run>.jsonl` with the speech in `results/<run>/`, into
 * a folder per run. A run already moved is left where it is; the pages and other files of results/ stay.
 */
export function migrateResults(): number {
  if (!fs.existsSync(resultsDir())) return 0
  let moved = 0
  for (const name of fs.readdirSync(resultsDir()).filter((entry) => entry.endsWith('.jsonl')).sort()) {
    const id = path.basename(name, '.jsonl')
    if (fs.existsSync(runFolder(id))) throw new Error(`${runFolder(id)} already exists; the run ${id} was moved before, or two runs share its name`)
    const speech = path.join(resultsDir(), id)
    fs.mkdirSync(runsDir(), { recursive: true })
    if (fs.existsSync(speech)) fs.renameSync(speech, runFolder(id))
    else fs.mkdirSync(runFolder(id))
    fs.renameSync(path.join(resultsDir(), name), runFile(id))
    moved++
  }
  return moved
}
