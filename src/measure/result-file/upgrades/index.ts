import type { Upgrades } from '../../../core/stored.ts'

/** A result file as raw JSON, one object a line, the run line first. */
type ResultLines = Array<Record<string, unknown>>

/**
 * The steps from the earliest result format this build reads, 12, each in a file `vNN-to-vMM.ts` that imports
 * nothing of the current form. The version is `format` in the run line.
 */
export const resultUpgrades: Upgrades<ResultLines> = {
  name: 'result format',
  earliest: 12,
  steps: []
}
