import { check, parseJsonObject, upgrade } from '../../core/stored.ts'
import { CAMPAIGN_FORMAT, campaign, type Campaign } from './format.ts'
import { campaignUpgrades, campaignVersion } from './upgrades/index.ts'

/** A campaign file in the current form, refused with the file and the field named when it does not fit. */
export function parseCampaign(text: string, place: string): Campaign {
  const raw = parseJsonObject(text, place)
  return check(campaign, { ...upgrade(campaignUpgrades, raw, campaignVersion(raw), place), format: CAMPAIGN_FORMAT }, place)
}

export const campaignText = (value: Campaign): string => `${JSON.stringify(value, null, 2)}\n`
