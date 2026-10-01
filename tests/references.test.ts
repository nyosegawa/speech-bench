import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EmbeddedTake } from '../src/neighbors.ts'
import { candidateGroups, copyReference, loadReference, writeCandidates, writeReference } from '../src/references.ts'
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

  it('never writes over candidates already made, which runs name', () => {
    const group = { name: 'voice', detail: '', takes: takes(4), tooShort: 0 }
    writeReference('voice-candidate-1', 'voice', 0.8, takes(2), () => 0.9, null)
    expect(() => writeCandidates(group, 'voice-candidate', 0.8, 3, 1)).toThrow(/exist already/)
  })

  it('keeps a chosen voice from being replaced by other audio', async () => {
    writeReference('one', 'voice', null, takes(2), () => 0.9, null)
    writeReference('other', 'voice', null, takes(3), () => 0.9, null)
    await copyReference('one', 'voice-chosen')
    await expect(copyReference('one', 'voice-chosen')).resolves.toMatchObject({ name: 'voice-chosen' })
    await expect(copyReference('other', 'voice-chosen')).rejects.toThrow(/other audio/)
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
  const sentences = ['s0', 's1', 's2', 's3', 's4']

  it('pairs the most alike takes first, uses no take twice, and makes each group long enough', () => {
    const groups = candidateGroups(table, sentences, () => 5, 0.8, 10, 3)
    expect(groups).toEqual([[0, 1], [2, 3]])
  })

  it('grows a group of short takes until it reaches the length', () => {
    const [first] = candidateGroups(table, sentences, () => 3, 0.8, 10, 1)
    expect(first).toHaveLength(4)
    expect(first!.slice(0, 2)).toEqual([0, 1])
  })

  it('keeps every pair of a group at the threshold and each sentence once, passing over a pair that cannot grow long enough', () => {
    // Take 5 says take 0's sentence and is the most alike to it. At 0.85, takes 0 and 1 find no third take to
    // reach 10 s, and takes 2 and 3 grow by take 5.
    const withRepeat = [
      [1, 0.95, 0.8, 0.8, 0.5, 0.99],
      [0.95, 1, 0.8, 0.8, 0.5, 0.5],
      [0.8, 0.8, 1, 0.9, 0.5, 0.87],
      [0.8, 0.8, 0.9, 1, 0.5, 0.86],
      [0.5, 0.5, 0.5, 0.5, 1, 0.5],
      [0.99, 0.5, 0.87, 0.86, 0.5, 1]
    ]
    const groups = candidateGroups(withRepeat, ['a', 'b', 'c', 'd', 'e', 'a'], () => 4, 0.85, 10, 3)
    expect(groups).toEqual([[2, 3, 5]])
  })
})
