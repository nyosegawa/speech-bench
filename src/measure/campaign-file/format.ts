import { z } from 'zod'
import { currentVersion } from '../../core/stored.ts'
import { campaignUpgrades } from './upgrades/index.ts'

/**
 * The version of the form of a campaign file, its `format`. A change to the form, an added field included, adds
 * a step to `upgrades/` and a sample of the new version to tests/fixtures/campaign-file.
 */
export const CAMPAIGN_FORMAT = currentVersion(campaignUpgrades)

/** A named experiment and the runs made for it, in the order they were made. */
export const campaign = z.strictObject({
  format: z.literal(CAMPAIGN_FORMAT),
  name: z.string(),
  runs: z.array(z.string())
})
export type Campaign = z.infer<typeof campaign>
