import { describe, expect, it } from 'vitest'
import { medianPitch, semitoneSpread } from '../src/pitch.ts'

const RATE = 24_000

/** A second of a voiced sound: a fundamental with weaker second and third harmonics, as a vowel has. */
function vowel(hz: number, seconds = 1): { sampleRate: number; samples: Float32Array } {
  const samples = Float32Array.from({ length: Math.round(seconds * RATE) }, (_, index) => {
    const phase = (2 * Math.PI * hz * index) / RATE
    return 0.4 * Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.15 * Math.sin(3 * phase)
  })
  return { sampleRate: RATE, samples }
}

describe('medianPitch', () => {
  it('finds the fundamental of a low and a high voice, not an octave off', () => {
    for (const hz of [110, 240]) {
      const found = medianPitch(vowel(hz))!
      expect(Math.abs(found - hz) / hz).toBeLessThan(0.02)
    }
  })

  it('has no pitch for silence', () => {
    expect(medianPitch({ sampleRate: RATE, samples: new Float32Array(RATE) })).toBeNull()
  })
})

describe('semitoneSpread', () => {
  it('is zero for one pitch and six semitones for sentences an octave apart', () => {
    expect(semitoneSpread([220, 220, 220])).toBe(0)
    expect(semitoneSpread([110, 220])).toBeCloseTo(6)
  })
})
