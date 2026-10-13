import type { Upgrades } from '../../../core/stored.ts'
import { v12ToV13 } from './v12-to-v13.ts'
import { v13ToV14 } from './v13-to-v14.ts'
import { v14ToV15 } from './v14-to-v15.ts'
import { v15ToV16 } from './v15-to-v16.ts'
import { v16ToV17 } from './v16-to-v17.ts'
import { v17ToV18 } from './v17-to-v18.ts'
import { v18ToV19 } from './v18-to-v19.ts'

/** A result file as raw JSON, one object a line, the run line first. */
export type ResultLines = Array<Record<string, unknown>>

/**
 * The steps from the earliest result format this build reads, 12, each in a file `vNN-to-vMM.ts` that imports
 * nothing of the current form. The version is `format` in the run line.
 */
export const resultUpgrades: Upgrades<ResultLines> = {
  name: 'result format',
  earliest: 12,
  steps: [v12ToV13, v13ToV14, v14ToV15, v15ToV16, v16ToV17, v17ToV18, v18ToV19]
}
