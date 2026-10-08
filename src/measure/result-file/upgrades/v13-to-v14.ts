import type { Step } from '../../../core/stored.ts'
import type { ResultLines } from './index.ts'

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A run line with `localBuild` as `build`, and each of its model's files marked as published. */
function upgradeRun(run: Raw): Raw {
  const upgraded = { ...run }
  if (isObject(run.runtime)) {
    const { localBuild, ...runtime } = run.runtime
    upgraded.runtime = { ...runtime, build: isObject(localBuild) ? { ...localBuild, ciRun: null } : null }
  }
  if (isObject(run.model) && Array.isArray(run.model.files)) {
    upgraded.model = { ...run.model, files: run.model.files.map((file: unknown) => (isObject(file) ? { source: 'huggingface', ...file } : file)) }
  }
  return upgraded
}

/**
 * Format 14 records a build of speech.cpp that ran in place of the release as `build`, with the run of speech.cpp's
 * CI that built it, where format 13 had `localBuild`: every build of format 13 was built on the machine, and a run
 * line of format 12 has no `localBuild` and ran the release. It also records where each model file came from, as a
 * local file can now run in place of a published one: every file of format 13 was published on Hugging Face.
 */
export const v13ToV14: Step<ResultLines> = {
  upgrade: ([run, ...records]) => [isObject(run) ? upgradeRun(run) : run!, ...records]
}
