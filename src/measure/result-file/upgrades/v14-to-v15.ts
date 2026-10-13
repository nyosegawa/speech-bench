import type { Step } from '../../../core/stored.ts'
import type { ResultLines } from './index.ts'

/** Format 15 records the memory the runtime's processes took. No run before it measured memory. */
export const v14ToV15: Step<ResultLines> = { adds: ['memory'] }
