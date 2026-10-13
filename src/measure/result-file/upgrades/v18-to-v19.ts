import type { Step } from '../../../core/stored.ts'
import type { ResultLines } from './index.ts'

/** Format 19 records the combination and round of a measurement plan a run was made for. Every run before it was made by hand. */
export const v18ToV19: Step<ResultLines> = { adds: ['plan'] }
