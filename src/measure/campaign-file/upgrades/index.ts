import type { Upgrades } from '../../../core/stored.ts'

/**
 * The steps from the earliest campaign format this build reads, 1, each in a file `vNN-to-vMM.ts` that imports
 * nothing of the current form.
 */
export const campaignUpgrades: Upgrades<Record<string, unknown>> = {
  name: 'campaign format',
  earliest: 1,
  steps: []
}

/** The version of a campaign file: its `format`. */
export const campaignVersion = (raw: Record<string, unknown>): unknown => raw.format
