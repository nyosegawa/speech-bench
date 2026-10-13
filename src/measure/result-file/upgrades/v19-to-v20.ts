import type { Step } from '../../../core/stored.ts'
import type { ResultLines } from './index.ts'

/** Format 20 records a second recognizer of synthesized speech and what it heard. No run before it had one. */
export const v19ToV20: Step<ResultLines> = { adds: ['secondRecognizer', 'secondTranscript'] }
