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

/** The version of a campaign file: its `format`, which campaigns written before they carried one lack, being of format 1. */
export const campaignVersion = (raw: Record<string, unknown>): unknown => ('format' in raw ? raw.format : 1)
