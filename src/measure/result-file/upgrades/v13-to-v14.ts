import type { Step } from '../../../core/stored.ts'
import type { ResultLines } from './index.ts'

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Format 14 records a build of speech.cpp that ran in place of the release as `build`, with the run of speech.cpp's
 * CI that built it, where format 13 had `localBuild`: every build of format 13 was built on the machine. A run line
 * of format 12 has no `localBuild` and ran the release.
 */
export const v13ToV14: Step<ResultLines> = {
  upgrade: ([run, ...records]) => {
    if (!isObject(run) || !isObject(run.runtime)) return [run!, ...records]
    const { localBuild, ...runtime } = run.runtime
    return [{ ...run, runtime: { ...runtime, build: isObject(localBuild) ? { ...localBuild, ciRun: null } : null } }, ...records]
  }
}
