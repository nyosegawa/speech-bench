import type { Campaign } from '../measure/campaigns.ts'
import type { AsrSummary, TtsSummary } from '../measure/report.ts'
import type { PageData } from '../pages/listen.ts'

/**
 * What the web server answers, shared with the web app, which imports these types only. A route and the
 * shape it answers with change together, here.
 */

/** GET /api/runs: every run with what it adds up to, and the campaigns it joined. */
export type RunRow = (AsrSummary | TtsSummary) & { id: string; campaigns: string[] }

/** GET /api/campaigns */
export type CampaignRow = Campaign

/** GET /api/listen?runs=a,b[&reference=name][&blind=1]: the synthesis runs named, sentence by sentence. */
export type ListenData = PageData

/** Any route that fails answers this, with a status of 400 for a request the bench cannot serve. */
export interface ApiError {
  error: string
}
