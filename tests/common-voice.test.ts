import { describe, expect, it } from 'vitest'
import { mono } from '../src/datasets/common-voice.ts'
import { sourceOf } from '../src/spellings/sources.ts'

describe('mono', () => {
  it('takes the mean of the channels, sample by sample, over the samples decoded', () => {
    expect([...mono([Float32Array.of(0.5, -0.5, 1), Float32Array.of(0.5, 0.5, 1)], 2)]).toEqual([0.5, 0])
    expect([...mono([Float32Array.of(0.25, 0.75)], 2)]).toEqual([0.25, 0.75])
  })
})

describe('sourceOf', () => {
  it('names the test split of Common Voice 8.0 by its locale, and refuses one that is not pinned', () => {
    expect(sourceOf('common-voice-8-ja-JP').locale).toBe('ja-JP')
    expect(() => sourceOf('common-voice-8-en-US')).toThrow()
  })
})
