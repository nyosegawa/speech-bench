import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyzeRun } from '../src/analysis/run-analysis.ts'
import { joinCampaign, readCampaign } from '../src/measure/campaigns.ts'
import { runFile } from '../src/measure/runs.ts'
import { encodeWav16 } from '../src/core/wav.ts'
import { ttsRun as ttsRunOf } from './run-records.ts'

let data: string
beforeEach(() => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-test-'))
  process.env.SPEECH_BENCH_DATA = data
})
afterEach(() => {
  delete process.env.SPEECH_BENCH_DATA
  fs.rmSync(data, { recursive: true, force: true })
})

const ttsRun = (id: string): string => [
  JSON.stringify(ttsRunOf({ set: { name: 'speak', locale: 'ja-JP', size: 1 }, seed: 1 })),
  JSON.stringify({ type: 'sentence', id, kind: 'reply', text: 'はい。', audio: `${id}.wav`, audioSeconds: 2, firstAudioSeconds: 0.1, totalSeconds: 0.5, transcript: 'はい。' })
].join('\n')

/** Two seconds of a tone, voice enough to embed. */
const tone = encodeWav16({ sampleRate: 16_000, samples: Float32Array.from({ length: 32_000 }, (_, index) => 0.3 * Math.sin(index / 8)) })

describe('campaigns', () => {
  it('keeps a run once however often it joins', () => {
    joinCampaign('voices', 'tts-a')
    joinCampaign('voices', 'tts-b')
    joinCampaign('voices', 'tts-a')
    expect(readCampaign('voices').runs).toEqual(['tts-a', 'tts-b'])
  })

  it('refuses a name that would leave the campaigns folder', () => {
    expect(() => joinCampaign('../runs', 'tts-a')).toThrow()
  })
})

describe('analyzeRun', () => {
  const embedderOf = (id: string) => {
    const embedder = { model: { id }, calls: 0, embed: () => { embedder.calls++; return Float32Array.from([1, 0]) } }
    return embedder
  }

  it('uses the analysis it kept, and makes it again for another speaker model', () => {
    fs.mkdirSync(path.dirname(runFile('tts-run')), { recursive: true })
    fs.writeFileSync(runFile('tts-run'), ttsRun('s0'))
    fs.writeFileSync(path.join(path.dirname(runFile('tts-run')), 's0.wav'), tone)
    const first = embedderOf('model-a')
    expect([...analyzeRun(runFile('tts-run'), first).s0!.embedding!]).toEqual([1, 0])
    analyzeRun(runFile('tts-run'), first)
    expect(first.calls).toBe(1)
    const other = embedderOf('model-b')
    analyzeRun(runFile('tts-run'), other)
    expect(other.calls).toBe(1)
  })

  it('makes the analysis again when it holds other takes than the run, or does not have the form of an analysis', () => {
    fs.mkdirSync(path.dirname(runFile('tts-run')), { recursive: true })
    fs.writeFileSync(runFile('tts-run'), ttsRun('s0'))
    fs.writeFileSync(path.join(path.dirname(runFile('tts-run')), 's0.wav'), tone)
    const stored = path.join(path.dirname(runFile('tts-run')), 'analysis.json')
    const embedder = embedderOf('model-a')
    fs.writeFileSync(stored, JSON.stringify({ version: 1, speakerModel: 'model-a', takes: { other: { voicedSeconds: 2, pitchHz: 200, embedding: null } } }))
    expect(Object.keys(analyzeRun(runFile('tts-run'), embedder))).toEqual(['s0'])
    expect(embedder.calls).toBe(1)
    fs.writeFileSync(stored, JSON.stringify({ version: 1, speakerModel: 'model-a', takes: { s0: { pitchHz: 200 } } }))
    analyzeRun(runFile('tts-run'), embedder)
    expect(embedder.calls).toBe(2)
  })
})
