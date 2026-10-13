import type { Upgrades } from '../../../core/stored.ts'

/**
 * The steps from the earliest plan format this build reads, 1, each in a file `vNN-to-vMM.ts` that imports nothing of
 * the current form.
 */
export const planUpgrades: Upgrades<Record<string, unknown>> = {
  name: 'plan format',
  earliest: 1,
  steps: []
}
