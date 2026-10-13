import { describe, expect, it } from 'vitest'
import { chunkGaps, leastAudioInHand } from '../src/measure/streaming.ts'

const chunks = (...pairs: Array<[number, number]>) => pairs.map(([seconds, audioSeconds]) => ({ seconds, audioSeconds }))

describe('streamed speech', () => {
  it('times each piece from the one before it', () => {
    expect(chunkGaps(chunks([0.05, 0.08], [0.13, 0.08], [0.2, 0.08])).map((gap) => Number(gap.toFixed(3)))).toEqual([0.08, 0.07])
  })

  it('holds the audio received less the time played since the first piece, at its least', () => {
    // 0.5 s in hand when the second piece comes 0.3 s later leaves 0.2 s; 0.9 s in hand at 1.0 s leaves -0.1 s.
    expect(leastAudioInHand(chunks([0.1, 0.5], [0.4, 0.4], [1.1, 0.4]))).toBeCloseTo(-0.1)
  })

  it('has no least audio for a sentence that came whole, which never waits', () => {
    expect(leastAudioInHand(chunks([2.0, 3.1]))).toBeNull()
  })
})
