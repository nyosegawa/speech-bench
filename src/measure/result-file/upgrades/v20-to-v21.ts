import type { Step } from '../../../core/stored.ts'
import type { ResultLines } from './index.ts'

/**
 * Format 21 records on a Mac the peak of the resident memory and the Metal memory summed in each sample. No run before
 * it did, and the two peaks it has may come from different samples.
 */
export const v20ToV21: Step<ResultLines> = { adds: ['peakTotalBytes'] }
