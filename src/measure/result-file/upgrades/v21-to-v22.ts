import type { Step } from '../../../core/stored.ts'
import type { ResultLines } from './index.ts'

/**
 * Format 22 records runs on Linux x64, whose GPU memory is the memory in use on the whole GPU (`device`). A run
 * before it was made on macOS or Windows, and reads as it was.
 */
export const v21ToV22: Step<ResultLines> = { upgrade: (lines) => lines }
