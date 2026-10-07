import { describe, expect, it } from 'vitest'
import { clusteredOrder, largestSet, voiceGroup } from '../src/analysis/neighbors.ts'
import type { TtsRunRecord } from '../src/measure/result-file/format.ts'
import { ttsRun } from './run-records.ts'

describe('clusteredOrder', () => {
  it('puts the takes of one voice next to each other', () => {
    // Takes 0 and 2 are one voice, 1 and 3 another.
    const similarity = [
      [1, 0.2, 0.9, 0.1],
      [0.2, 1, 0.15, 0.85],
      [0.9, 0.15, 1, 0.2],
      [0.1, 0.85, 0.2, 1]
    ]
    const order = clusteredOrder(similarity)
    expect(order).toHaveLength(4)
    const positions = (a: number, b: number): number => Math.abs(order.indexOf(a) - order.indexOf(b))
    expect(positions(0, 2)).toBe(1)
    expect(positions(1, 3)).toBe(1)
  })
})

describe('largestSet', () => {
  // Take 0 is between two voices: 1 and 2 are one voice, 3 and 4 another, each close to 0 but not to each other.
  const similarity = [
    [1, 0.85, 0.85, 0.85, 0.85],
    [0.85, 1, 0.9, 0.3, 0.3],
    [0.85, 0.9, 1, 0.3, 0.3],
    [0.85, 0.3, 0.3, 1, 0.9],
    [0.85, 0.3, 0.3, 0.9, 1]
  ]
  const sentences = ['a', 'b', 'c', 'd', 'e']

  it('keeps every pair of a set alike, where a set held around its center mixes two voices', () => {
    expect(largestSet(similarity, sentences, 0.8, false).members).toHaveLength(5)
    const held = largestSet(similarity, sentences, 0.8, true)
    expect(held.members).toHaveLength(3)
    expect(held.weakest).toBeGreaterThanOrEqual(0.8)
  })

  it('takes one take of each sentence', () => {
    const set = largestSet(similarity, ['a', 'b', 'b', 'd', 'd'], 0.8, false)
    expect(new Set(set.members.map((member) => ['a', 'b', 'b', 'd', 'd'][member])).size).toBe(set.members.length)
  })
})

describe('voiceGroup', () => {
  const run = (design: string | null, seed: number, options: Record<string, string> = {}): TtsRunRecord => ttsRun({
    model: { id: 'irodori', label: 'Irodori', license: 'MIT', files: [] }, seed,
    design: design === null ? null : { id: design, instruction: `${design} words` },
    runtime: { id: 'audio.cpp', version: 'v1', localBuild: null, options }
  })

  it('puts the seeds of one description together and keeps descriptions and load options apart', () => {
    expect(voiceGroup(run('young-woman-words', 1)).key).toBe(voiceGroup(run('young-woman-words', 2)).key)
    expect(voiceGroup(run('young-woman-words', 1)).key).not.toBe(voiceGroup(run('young-man-words', 1)).key)
    expect(voiceGroup(run('young-woman-words', 1)).key).not.toBe(voiceGroup(run('young-woman-words', 1, { 'irodori_tts.codec_backend': 'cpu' })).key)
  })
})
