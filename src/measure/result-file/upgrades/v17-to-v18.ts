import type { Step } from '../../../core/stored.ts'
import type { ResultLines } from './index.ts'

/** Format 18 records whether the model was loaded cold, from copies no file cache held. No run before it was. */
export const v17ToV18: Step<ResultLines> = { adds: ['coldLoad'] }
