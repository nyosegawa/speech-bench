import fs from 'node:fs'
import path from 'node:path'
import { isSafeName } from './datasets/recordings.ts'
import { campaignsDir } from './paths.ts'

/** A named experiment and the runs made for it, in the order they were made. */
export interface Campaign {
  name: string
  runs: string[]
}

const campaignFile = (name: string): string => {
  if (!isSafeName(name)) throw new Error(`campaign ${JSON.stringify(name)} is not lower-case letters, digits, - and _`)
  return path.join(campaignsDir(), `${name}.json`)
}

export function readCampaign(name: string): Campaign {
  const file = campaignFile(name)
  if (!fs.existsSync(file)) throw new Error(`there is no campaign ${name}; runs join one with --campaign ${name}`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Campaign
}

/** Adds a run to a campaign, which is made when it has none yet. */
export function joinCampaign(name: string, run: string): void {
  const file = campaignFile(name)
  const campaign: Campaign = fs.existsSync(file) ? readCampaign(name) : { name, runs: [] }
  if (!campaign.runs.includes(run)) campaign.runs.push(run)
  fs.mkdirSync(campaignsDir(), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(campaign, null, 2)}\n`)
}

export function listCampaigns(): Campaign[] {
  if (!fs.existsSync(campaignsDir())) return []
  return fs.readdirSync(campaignsDir()).filter((name) => name.endsWith('.json')).sort().map((name) => readCampaign(path.basename(name, '.json')))
}
