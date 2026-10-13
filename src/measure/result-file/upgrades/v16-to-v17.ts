import type { Step } from '../../../core/stored.ts'
import type { ResultLines } from './index.ts'

/** Format 17 records the pieces a sentence's audio arrived in. No sentence before it recorded them. */
export const v16ToV17: Step<ResultLines> = { adds: ['chunks'] }
