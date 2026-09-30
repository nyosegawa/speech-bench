import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EmbeddedTake } from '../src/neighbors.ts'
import { candidateGroups, loadReference, writeReference } from '../src/references.ts'
import { encodeWav16, readWav } from '../src/wav.ts'

describe('reference voices', () => {
  let data: string
  beforeEach(() => {
    data = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-test-'))
    process.env.SPEECH_BENCH_DATA = data
  })
  afterEach(() => {
    delete process.env.SPEECH_BENCH_DATA
    fs.rmSync(data, { recursive: true, force: true })
  })

  /** Takes of two seconds of a tone each, at 24 kHz. */
  function takes(count: number): EmbeddedTake[] {
    return Array.from({ length: count }, (_, index) => {
      const audio = path.join(data, `take-${index}.wav`)
      fs.writeFileSync(audio, encodeWav16({ sampleRate: 24_000, samples: Float32Array.from({ length: 48_000 }, (_, sample) => 0.3 * Math.sin(sample / (10 + index))) }))
      return { label: `take ${index}`, sentence: `s${index}`, seed: 1, text: `text ${index}`, audio, seconds: 2, embedding: new Float32Array(1) }
    })
  }

  it('joins takes in order, with a short silence between, until they reach the length asked for', async () => {
    const written = writeReference('voice', 'group', 0.8, takes(5), () => 0.9, 5)
    expect(written.takes.map((take) => take.label)).toEqual(['take 0', 'take 1', 'take 2'])
    const reference = await loadReference('voice')
    expect(reference.seconds).toBeCloseTo(2 * 3 + 0.3 * 2, 1)
    expect(readWav(fs.readFileSync(reference.file)).sampleRate).toBe(24_000)
  })

  it('writes every take named by hand, whatever their length', async () => {
    const written = writeReference('by-hand', 'group', null, takes(4), () => 0.9, null)
    expect(written.takes).toHaveLength(4)
    expect(written.threshold).toBeNull()
    expect((await loadReference('by-hand')).seconds).toBeCloseTo(2 * 4 + 0.3 * 3, 1)
  })

  it('refuses a set shorter than the length asked for, and a reference that was never written', async () => {
    expect(() => writeReference('voice', 'group', 0.8, takes(2), () => 0.9, 30)).toThrow(/less than the 30 s/)
    await expect(loadReference('missing')).rejects.toThrow(/no reference voice missing/)
  })
})

describe('candidateGroups', () => {
  // Takes 0 and 1 are the most alike, then 2 and 3; take 4 is alike to nothing.
  const table = [
    [1, 0.95, 0.8, 0.8, 0.5],
    [0.95, 1, 0.8, 0.8, 0.5],
    [0.8, 0.8, 1, 0.9, 0.5],
    [0.8, 0.8, 0.9, 1, 0.5],
    [0.5, 0.5, 0.5, 0.5, 1]
  ]
  const similarity = (a: number, b: number): number => table[a]![b]!

  it('pairs the most alike takes first, uses no take twice, and makes each group long enough', () => {
    const groups = candidateGroups([0, 1, 2, 3, 4], similarity, () => 5, 10, 3)
    expect(groups).toEqual([[0, 1], [2, 3]])
  })

  it('grows a group of short takes until it reaches the length', () => {
    const [first] = candidateGroups([0, 1, 2, 3, 4], similarity, () => 3, 10, 1)
    expect(first).toHaveLength(4)
    expect(first!.slice(0, 2)).toEqual([0, 1])
  })
})
