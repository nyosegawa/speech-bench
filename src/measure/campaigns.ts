import fs from 'node:fs'
import path from 'node:path'
import { isSafeName } from '../datasets/recordings.ts'
import { campaignsDir } from '../core/paths.ts'
import { campaignText, parseCampaign } from './campaign-file/file.ts'
import { CAMPAIGN_FORMAT, type Campaign } from './campaign-file/format.ts'

const campaignFile = (name: string): string => {
  if (!isSafeName(name)) throw new Error(`campaign ${JSON.stringify(name)} is not lower-case letters, digits, - and _`)
  return path.join(campaignsDir(), `${name}.json`)
}

export function readCampaign(name: string): Campaign {
  const file = campaignFile(name)
  if (!fs.existsSync(file)) throw new Error(`there is no campaign ${name}; runs join one with --campaign ${name}`)
  return parseCampaign(fs.readFileSync(file, 'utf8'), file)
}

/** Adds a run to a campaign, which is made when it has none yet. */
export function joinCampaign(name: string, run: string): void {
  const file = campaignFile(name)
  const campaign: Campaign = fs.existsSync(file) ? readCampaign(name) : { format: CAMPAIGN_FORMAT, name, runs: [] }
  if (!campaign.runs.includes(run)) campaign.runs.push(run)
  fs.mkdirSync(campaignsDir(), { recursive: true })
  fs.writeFileSync(file, campaignText(campaign))
}

/** The runs of a campaign, none for one no run has joined yet. */
export const campaignRuns = (name: string): string[] => (fs.existsSync(campaignFile(name)) ? readCampaign(name).runs : [])

export function listCampaigns(): Campaign[] {
  if (!fs.existsSync(campaignsDir())) return []
  return fs.readdirSync(campaignsDir()).filter((name) => name.endsWith('.json')).sort().map((name) => readCampaign(path.basename(name, '.json')))
}
