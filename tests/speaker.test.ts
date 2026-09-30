import { describe, expect, it } from 'vitest'
import { across, cosine, likenessToTheRest, pairwise, voicedSeconds } from '../src/speaker.ts'

const vector = (...values: number[]): Float32Array => Float32Array.from(values)

describe('cosine', () => {
  it('is 1 for one direction whatever the length, 0 at a right angle and -1 opposite', () => {
    expect(cosine(vector(1, 2), vector(2, 4))).toBeCloseTo(1)
    expect(cosine(vector(1, 0), vector(0, 3))).toBeCloseTo(0)
    expect(cosine(vector(1, 1), vector(-1, -1))).toBeCloseTo(-1)
  })

  it('refuses embeddings of different sizes, which come from different models', () => {
    expect(() => cosine(vector(1, 0), vector(1, 0, 0))).toThrow(/dimensions/)
  })
})

describe('comparing utterances', () => {
  it('singles out the one utterance spoken in another voice', () => {
    const likeness = likenessToTheRest([vector(1, 0.1), vector(1, 0), vector(0.9, 0.1), vector(0, 1)])
    expect(likeness.indexOf(Math.min(...likeness))).toBe(3)
  })

  it('compares each pair of one set once and every pair across two sets', () => {
    expect(pairwise([vector(1, 0), vector(1, 0), vector(0, 1)])).toHaveLength(3)
    expect(across([vector(1, 0), vector(0, 1)], [vector(1, 0)])).toEqual([1, 0])
  })
})

describe('voicedSeconds', () => {
  it('counts the voice and not the silence around it', () => {
    const rate = 16_000
    const samples = Float32Array.from({ length: rate * 3 }, (_, index) => (index >= rate && index < rate * 2 ? 0.3 * Math.sin((2 * Math.PI * 200 * index) / rate) : 0.001))
    expect(voicedSeconds({ sampleRate: rate, samples })).toBeCloseTo(1, 1)
  })
})
