import type { ListenData } from '@/lib/api.ts'
import { LIMITS } from '@/lib/figures.ts'

export type ListenedRun = ListenData['runs'][number]
export type Sentence = ListenData['sentences'][number]
export type Take = NonNullable<Sentence['takes'][number]>

/** A take of the listening page as the player plays it: one sentence as one run spoke it, by their places. */
export interface TakeRef {
  sentence: number
  run: number
}

export const brokenIn = (data: ListenData, run: number): number =>
  data.sentences.filter((sentence) => (sentence.takes[run]?.heardErrorRate ?? 0) > LIMITS.broken).length
