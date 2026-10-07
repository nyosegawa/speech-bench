import type { Step } from '../../../core/stored.ts'
import type { ResultLines } from './index.ts'

/**
 * Format 13 records the commit of a local build that ran in place of a runtime's release. Every run of format 12
 * ran a pinned release.
 */
export const v12ToV13: Step<ResultLines> = { adds: ['runtime.localBuild'] }
