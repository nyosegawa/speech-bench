import type { CSSProperties } from 'react'
import type { ListenData } from '@/lib/api.ts'

export type ListenedRun = ListenData['runs'][number]
export type Sentence = ListenData['sentences'][number]
export type Take = NonNullable<Sentence['takes'][number]>

/**
 * Where a figure turns good or bad. The sameness of voice and the pitch spread are read against measured
 * voices (2026-10-01): one real speaker's recordings 0.84 alike and 0.33 like other men's, Qwen3-TTS's ono_anna
 * 0.76 with a pitch spread of 1.5 to 1.8 semitones, and Irodori-TTS without a voice description 0.47 to
 * 0.57 with 3.6 to 6.6. A sentence heard with more than 30% of its characters wrong has broken down.
 */
export const LIMITS = { sameGood: 0.72, sameBad: 0.58, spreadGood: 2, spreadBad: 3, cerGood: 0.01, cerBad: 0.05, broken: 0.3, oddTake: 0.5 }

export type Verdict = 'good' | 'bad' | null

export const judge = (value: number, good: number, bad: number, higherIsBetter: boolean): Verdict =>
  higherIsBetter ? (value >= good ? 'good' : value < bad ? 'bad' : null) : value <= good ? 'good' : value >= bad ? 'bad' : null

export const verdictClass: Record<'good' | 'bad', string> = {
  good: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 font-semibold',
  bad: 'bg-red-500/12 text-red-700 dark:text-red-400 font-semibold'
}

/** The color a run keeps everywhere on the page, as the CSS variable `--run`. */
export const runColor = (run: number): CSSProperties => ({ '--run': `var(--run-${run % 10})` }) as CSSProperties

export const brokenIn = (data: ListenData, run: number): number =>
  data.sentences.filter((sentence) => (sentence.takes[run]?.heardErrorRate ?? 0) > LIMITS.broken).length
