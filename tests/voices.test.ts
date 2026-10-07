import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ListenedRun } from '../src/pages/listen.ts'
import { REFERENCE_MANIFEST_FORMAT, type ReferenceManifest } from '../src/make/reference-manifest/format.ts'
import type { SentenceRecord } from '../src/measure/result-file/format.ts'
import { ttsRun } from './run-records.ts'
import { splitShared, voicesData } from '../src/pages/voices.ts'

const runs = path.join(path.sep, 'data', 'runs')
/** Links a file by its path, so that a test sees which file a take plays. */
const byPath = (file: string): string => `file:${file}`

/** A run that spoke like `reference`, one sentence per embedding, heard as said unless `misheard` names one. */
function run(reference: string, seed: number, embeddings: number[][], options: { set?: string; misheard?: number; durationScale?: number } = {}): ListenedRun {
  const record = ttsRun({
    startedAt: '2026-10-01T00:00:00Z', set: { name: options.set ?? 'speak-ja-JP-20', locale: 'ja-JP', size: embeddings.length },
    seed, reference: { name: reference, sha256: '0', seconds: 10 }, durationScale: options.durationScale ?? null,
    model: { id: 'irodori', label: 'Irodori', license: 'MIT', files: [] },
    machine: { platform: 'win32-x64', hostname: 'pc', os: 'Windows 11', cpu: 'Intel Core i9-9900K', memoryGb: 32, gpus: ['RTX 2080'] },
    runtime: { id: 'audio.cpp', version: 'v1', localBuild: null, options: {} }
  })
  const sentences: SentenceRecord[] = embeddings.map((_, index) => ({
    type: 'sentence', id: `s${index}`, kind: 'reply', text: 'はい、わかりました。', audio: `s${index}.wav`, audioSeconds: 2, firstAudioSeconds: 0.5, totalSeconds: 1,
    transcript: index === options.misheard ? 'いいえ、ちがいます。' : 'はい、わかりました。'
  }))
  return {
    file: path.join(runs, `tts-${reference}-seed${seed}`, 'run.jsonl'),
    run: record,
    sentences,
    pitches: Object.fromEntries(sentences.map((sentence) => [sentence.id, 220])),
    likeness: Object.fromEntries(sentences.map((sentence) => [sentence.id, 0.8])),
    embeddings: Object.fromEntries(sentences.map((sentence, index) => [sentence.id, Float32Array.from(embeddings[index]!)])),
    likeReference: Object.fromEntries(sentences.map((sentence) => [sentence.id, 0.85]))
  }
}

const groupOf: Record<string, string> = { 'a-1': 'Irodori, a', 'a-2': 'Irodori, a', 'b-1': 'Irodori, b' }
const reference = (name: string): { manifest: ReferenceManifest; file: string } => ({
  manifest: { format: REFERENCE_MANIFEST_FORMAT, name, group: groupOf[name]!, threshold: 0.8, seconds: 10, takes: [{ audio: 'x.wav', label: 'x', text: 'こんにちは。', seconds: 5, likenessToCenter: 1 }], meanSimilarity: 0.9, weakestPair: 0.9 },
  file: path.join(path.sep, 'data', 'references', `${name}.wav`)
})

describe('voicesData', () => {
  it('groups the runs by reference and the references by the voice they were gathered from', () => {
    const data = voicesData([run('b-1', 1, [[1, 0], [1, 0]]), run('a-2', 1, [[1, 0], [1, 0]]), run('a-1', 2, [[1, 0], [1, 0]]), run('a-1', 1, [[1, 0], [1, 0]])], reference, byPath, 'voices')
    expect(data.shared).toBe('Irodori')
    expect(data.voices.map((voice) => [voice.name, voice.candidates.map((index) => data.candidates[index]!.name)])).toEqual([['a', ['a-1', 'a-2']], ['b', ['b-1']]])
    expect(data.candidates[0]!.runs).toEqual(['seed 1', 'seed 2'])
    expect(data.sentences[0]!.takes[0]!.map((take) => take?.url)).toEqual([byPath(path.join(runs, 'tts-a-1-seed1', 's0.wav')), byPath(path.join(runs, 'tts-a-1-seed2', 's0.wav'))])
  })

  it('picks the candidate with the smallest share of broken takes, then the most alike takes across its seeds', () => {
    const alikeButBroken = [run('a-1', 1, [[1, 0], [1, 0]], { misheard: 0 }), run('a-1', 2, [[1, 0], [1, 0]])]
    const lessAlike = [run('a-2', 1, [[1, 0], [0.6, 0.8]]), run('a-2', 2, [[1, 0], [0.6, 0.8]])]
    const data = voicesData([...alikeButBroken, ...lessAlike, run('b-1', 1, [[0, 1], [0, 1]])], reference, byPath, 'voices')
    const [a1, a2] = data.voices[0]!.candidates
    expect(data.candidates[a1!]!.broken).toBe(1)
    expect(data.voices[0]!.best).toBe(a2)
    expect(data.candidates[a2!]!.sameVoice).toBeCloseTo((0.6 + 1 + 0.6 + 0.6 + 1 + 0.6) / 6, 5)
  })

  it('compares every take of one candidate with every take of another', () => {
    const data = voicesData([run('a-1', 1, [[1, 0], [1, 0]]), run('b-1', 1, [[1, 0], [0, 1]])], reference, byPath, 'voices')
    const [a1] = data.voices[0]!.candidates
    const [b1] = data.voices[1]!.candidates
    expect(data.similarity[a1!]![b1!]).toBeCloseTo(0.5, 5)
    expect(data.similarity[b1!]![b1!]).toBeCloseTo(0, 5)
  })

  it('compares broken takes as a share of each candidate\'s takes, which differ when a seed is missing', () => {
    const oneSeedOneBroken = [run('a-1', 1, [[1, 0], [1, 0]], { misheard: 0 })]
    const twoSeedsOneBroken = [run('a-2', 1, [[1, 0], [0.6, 0.8]], { misheard: 0 }), run('a-2', 2, [[1, 0], [0.6, 0.8]])]
    const data = voicesData([...oneSeedOneBroken, ...twoSeedsOneBroken, run('b-1', 1, [[0, 1], [0, 1]])], reference, byPath, 'voices')
    const [, a2] = data.voices[0]!.candidates
    expect(data.voices[0]!.best).toBe(a2)
  })

  it('stops when the runs of one reference had their lengths scaled differently', () => {
    expect(() => voicesData([run('a-1', 1, [[1, 0]]), run('a-1', 2, [[1, 0]], { durationScale: 0.5 })], reference, byPath, 'voices')).toThrow()
  })

  it('stops when the runs spoke different sets of sentences', () => {
    expect(() => voicesData([run('a-1', 1, [[1, 0]]), run('b-1', 1, [[1, 0]], { set: 'speak-ja-JP-10' })], reference, byPath, 'voices')).toThrow()
  })
})

describe('splitShared', () => {
  it('says once what every name shares up to a comma', () => {
    expect(splitShared(['Irodori-TTS v4 Small, soft-young-woman', 'Irodori-TTS v4 Small, soft-old-woman'])).toEqual({ shared: 'Irodori-TTS v4 Small', rest: ['soft-young-woman', 'soft-old-woman'] })
    expect(splitShared(['one voice', 'another voice'])).toEqual({ shared: '', rest: ['one voice', 'another voice'] })
  })
})
