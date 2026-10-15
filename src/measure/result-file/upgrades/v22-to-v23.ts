import type { Step } from '../../../core/stored.ts'
import type { ResultLines } from './index.ts'

/**
 * Format 23 records the transcript of the reference voice a model that clones a voice from its words too was given,
 * Drama 3 the first. No run before it gave one.
 */
export const v22ToV23: Step<ResultLines> = { adds: ['transcript'] }
