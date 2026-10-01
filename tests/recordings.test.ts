import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readManifest, recordingSet, saveRecording } from '../src/datasets/recordings.ts'
import { encodeWav16 } from '../src/core/wav.ts'

const wav = (sampleRate: number): Buffer => encodeWav16({ sampleRate, samples: new Float32Array(sampleRate / 10) })
const guest = { locale: 'ja-JP', speaker: 'guest' }
const sakasegawa = { locale: 'ja-JP', speaker: 'sakasegawa' }

describe('saveRecording', () => {
  let data: string
  beforeEach(() => {
    data = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-test-'))
    process.env.SPEECH_BENCH_DATA = data
  })
  afterEach(() => {
    delete process.env.SPEECH_BENCH_DATA
    fs.rmSync(data, { recursive: true, force: true })
  })

  it('writes the audio and lists it in the manifest the runs read', () => {
    saveRecording(guest, 'short-hai', 'はい', wav(16_000))
    const set = recordingSet(guest)
    expect(set.utterances).toEqual([{ id: 'short-hai', audio: path.join(data, 'recordings', 'ja-JP', 'guest', 'short-hai.wav'), reference: 'はい' }])
    expect(fs.existsSync(set.utterances[0]!.audio)).toBe(true)
  })

  it('replaces an earlier recording of the same id', () => {
    saveRecording(guest, 'short-hai', 'はい', wav(16_000))
    saveRecording(guest, 'short-iie', 'いいえ', wav(16_000))
    saveRecording(guest, 'short-hai', 'はーい', wav(16_000))
    expect(readManifest(guest).map((entry) => [entry.id, entry.text])).toEqual([['short-iie', 'いいえ'], ['short-hai', 'はーい']])
  })

  it('keeps the same prompt recorded by two speakers apart, as sets of their own', () => {
    saveRecording(sakasegawa, 'short-hai', 'はい', wav(16_000))
    saveRecording(guest, 'short-hai', 'はーい', wav(16_000))
    const sets = [recordingSet(sakasegawa), recordingSet(guest)]
    expect(sets.map((set) => set.utterances.map((utterance) => utterance.reference))).toEqual([['はい'], ['はーい']])
    expect(new Set(sets.map((set) => set.name)).size).toBe(2)
    expect(sets[0]!.utterances[0]!.audio).not.toBe(sets[1]!.utterances[0]!.audio)
  })

  it('refuses audio that is not 16 kHz, an empty text, and an id or a speaker that is not a safe file name', () => {
    expect(() => saveRecording(guest, 'short-hai', 'はい', wav(48_000))).toThrow(/16 kHz/)
    expect(() => saveRecording(guest, 'short-hai', '  ', wav(16_000))).toThrow()
    expect(() => saveRecording(guest, '../escape', 'はい', wav(16_000))).toThrow()
    expect(() => saveRecording({ locale: 'ja-JP', speaker: '..' }, 'short-hai', 'はい', wav(16_000))).toThrow()
    expect(readManifest(guest)).toEqual([])
    expect(fs.existsSync(path.join(data, 'recordings'))).toBe(false)
  })
})
