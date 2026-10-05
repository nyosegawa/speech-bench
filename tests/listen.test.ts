import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { latestRuns, listeningData, runNames, type ListenedRun } from '../src/pages/listen.ts'
import type { SentenceRecord } from '../src/measure/result-file/format.ts'
import { ttsRun } from './run-records.ts'

const runs = path.join(path.sep, 'data', 'runs')
/** Links a file by its path, so that a test sees which file a take plays. */
const byPath = (file: string): string => `file:${file}`
const sentence: SentenceRecord = { type: 'sentence', id: 'aizuchi-hai', kind: 'aizuchi', text: 'はい。', audio: 'aizuchi-hai.wav', audioSeconds: 0.5, firstAudioSeconds: 0.05, totalSeconds: 0.2, transcript: 'はい。' }

interface RunOptions { set?: string; seed?: number; design?: string; reference?: string; durationScale?: number; gpu?: string; transcript?: string; pitches?: number[]; likeness?: Array<number | null> }

function run(model: string, startedAt: string, options: RunOptions = {}): ListenedRun {
  const record = ttsRun({
    startedAt, set: { name: options.set ?? 'speak-ja-JP-20', locale: 'ja-JP', size: 1 }, seed: options.seed ?? null,
    design: options.design === undefined ? null : { id: options.design, instruction: `${options.design} instruction` },
    reference: options.reference === undefined ? null : { name: options.reference, sha256: '0', seconds: 30 },
    durationScale: options.durationScale ?? null,
    model: { id: model, label: `${model} label`, license: 'MIT', files: [] },
    machine: { platform: 'darwin-arm64', hostname: 'mac', os: 'macOS 26.2', cpu: 'Apple M5', memoryGb: 32, gpus: [options.gpu ?? 'Apple M5'] },
    runtime: { id: 'audio.cpp', version: 'v1', options: {} }
  })
  const pitches = options.pitches ?? [220]
  const sentences = pitches.map((_, index) => ({ ...sentence, id: `${sentence.id}-${index}`, ...(options.transcript === undefined ? {} : { transcript: options.transcript }) }))
  const stem = `tts-${startedAt}-${model}${options.design === undefined ? '' : `-${options.design}`}${options.seed === undefined ? '' : `-seed${options.seed}`}`
  const likeness = options.likeness ?? pitches.map(() => 0.7)
  return {
    file: path.join(runs, stem, 'run.jsonl'),
    run: record,
    sentences,
    pitches: Object.fromEntries(sentences.map((spoken, index) => [spoken.id, pitches[index]!])),
    likeness: Object.fromEntries(sentences.map((spoken, index) => [spoken.id, likeness[index]!])),
    embeddings: {},
    likeReference: {}
  }
}

describe('latestRuns', () => {
  it('keeps the newest run of a model on a machine', () => {
    const kept = latestRuns([run('a', '2026-09-30T01:00:00Z'), run('a', '2026-09-30T02:00:00Z'), run('b', '2026-09-30T01:30:00Z')])
    expect(kept.map((entry) => [entry.run.model.id, entry.run.startedAt])).toEqual([['a', '2026-09-30T02:00:00Z'], ['b', '2026-09-30T01:30:00Z']])
  })

  it('keeps a run for every seed and every voice design of a model', () => {
    const kept = latestRuns([1, 2, 3].map((seed) => run('a', `2026-09-30T0${seed}:00:00Z`, { seed })))
    expect(kept.map((entry) => entry.run.seed)).toEqual([1, 2, 3])
    const designs = latestRuns(['young-woman-words', 'young-man-words'].map((design) => run('a', '2026-09-30T01:00:00Z', { design, seed: 1 })))
    expect(designs).toHaveLength(2)
  })

  it('keeps a run for every reference voice, and apart from the same description without one', () => {
    const kept = latestRuns([
      run('a', '2026-09-30T01:00:00Z', { reference: 'voice-10s', seed: 1 }),
      run('a', '2026-09-30T02:00:00Z', { reference: 'voice-30s', seed: 1 }),
      run('a', '2026-09-30T03:00:00Z', { design: 'young-woman-words', seed: 1 }),
      run('a', '2026-09-30T04:00:00Z', { design: 'young-woman-words', reference: 'voice-30s', seed: 1 })
    ])
    expect(kept).toHaveLength(4)
  })

  it('keeps a run for every length factor of one reference, and tells them apart by name', () => {
    const runs = latestRuns([undefined, 0.5, 0.7].map((durationScale) => run('a', '2026-10-01T01:00:00Z', { reference: 'voice', seed: 1, ...(durationScale === undefined ? {} : { durationScale }) })))
    expect(runs).toHaveLength(3)
    expect(new Set(runNames(runs).names).size).toBe(3)
  })
})

describe('runNames', () => {
  it('tells one model on two machines apart by their GPUs', () => {
    const { names } = runNames([run('a', '2026-09-30T01:00:00Z'), run('a', '2026-09-30T01:00:00Z', { gpu: 'NVIDIA GeForce RTX 2080' })])
    expect(new Set(names).size).toBe(2)
  })
})

describe('listeningData', () => {
  it('links each sentence to the audio in its run\'s folder', () => {
    const data = listeningData([run('a', '2026-09-30T01:00:00Z')], byPath, false)
    expect(data.sentences[0]!.takes[0]!.url).toBe(byPath(path.join(runs, 'tts-2026-09-30T01:00:00Z-a', 'aizuchi-hai.wav')))
    expect(data.runs[0]!.name).toBe('a label')
  })

  it('spreads a voice that turns an octave between sentences over six semitones, and one that holds over none', () => {
    const data = listeningData([run('a', '2026-09-30T01:00:00Z', { pitches: [110, 220] }), run('b', '2026-09-30T01:00:00Z', { pitches: [220, 220] })], byPath, false)
    expect(data.runs.map((entry) => entry.pitchSpread)).toEqual([expect.closeTo(6), 0])
  })

  it('rates a run as one voice by the mean likeness of its sentences to each other', () => {
    const data = listeningData([run('a', '2026-09-30T01:00:00Z', { pitches: [220, 220, 220], likeness: [0.8, 0.7, 0.3] })], byPath, false)
    expect(data.runs[0]!.sameVoice).toBeCloseTo(0.6)
    expect(data.sentences.map((sentence) => sentence.takes[0]!.likeness)).toEqual([0.8, 0.7, 0.3])
  })

  it('leaves a sentence too short to judge out of the sameness of voice', () => {
    const data = listeningData([run('a', '2026-09-30T01:00:00Z', { pitches: [220, 220, 220], likeness: [0.8, 0.6, null] })], byPath, false)
    expect(data.runs[0]!.sameVoice).toBeCloseTo(0.7)
    expect(data.sentences[2]!.takes[0]!.likeness).toBeNull()
  })

  it('hides the names, the descriptions, what was heard, the timings and the pitches on a blind page, and keeps the names for the key', () => {
    const data = listeningData([run('a', '2026-09-30T01:00:00Z', { design: 'young-woman-words' }), run('b', '2026-09-30T01:00:00Z')], byPath, true, () => 0.5)
    expect(data.runs.map((entry) => entry.name)).toEqual(['A', 'B'])
    expect(data.runs.every((entry) => entry.heardErrorRate === undefined && entry.instruction === undefined && entry.pitchSpread === undefined && entry.sameVoice === undefined)).toBe(true)
    expect(data.sentences[0]!.takes.every((take) => take?.transcript === undefined && take?.firstAudioSeconds === undefined && take?.pitchHz === undefined && take?.likeness === undefined)).toBe(true)
    expect(data.key).toEqual(['A: a label, young-woman-words', 'B: b label'])
  })

  it('refuses runs of different sets of sentences', () => {
    expect(() => listeningData([run('a', '2026-09-30T01:00:00Z'), run('b', '2026-09-30T01:00:00Z', { set: 'speak-ja-JP-5' })], byPath, false)).toThrow()
  })
})
