import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { transcriptsData } from '../src/pages/transcripts.ts'
import { readSpellings } from '../src/spellings/files.ts'

let folder: string
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-test-'))
})
afterEach(() => fs.rmSync(folder, { recursive: true, force: true }))

/** A recognition run of `model` on `set` that heard each utterance as `heard` says, or dropped it for null. */
function writeRun(id: string, model: string, set: string, heard: Array<[string, string, string | null]>): string {
  const run = {
    type: 'run', format: 11, task: 'asr', startedAt: '2026-10-01T00:00:00.000Z', set: { name: set, locale: 'ja-JP', size: heard.length },
    model: { id: model, label: `${model} label`, license: 'MIT', files: [] }, runtime: { id: 'llama.cpp', version: 'b1', options: {} },
    machine: { platform: 'darwin-arm64', hostname: 'mac', os: 'macOS', cpu: 'M5', memoryGb: 32, gpus: ['Apple M5'] },
    audio: { edges: 'voice', detector: 'silero-vad-v4', marginSeconds: 0.2 }, loadSeconds: 1, warmupSeconds: 1
  }
  const records = heard.map(([utterance, reference, text]) => (text === null
    ? { type: 'utterance', id: utterance, reference, droppedBy: 'no-voice' }
    : { type: 'utterance', id: utterance, audioSeconds: 2, reference, text, seconds: 0.1 }))
  const file = path.join(folder, id, 'run.jsonl')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, [run, ...records].map((record) => JSON.stringify(record)).join('\n') + '\n')
  return file
}

describe('transcriptsData', () => {
  it('sets what each run heard of an utterance side by side, named by the model that heard it', () => {
    const a = writeRun('asr-a', 'qwen', 'fleurs-ja', [['u1', 'こんにちは', 'こんばんは'], ['u2', 'はい', 'はい']])
    const b = writeRun('asr-b', 'parakeet', 'fleurs-ja', [['u1', 'こんにちは', 'こんにちは'], ['u2', 'はい', null]])
    const data = transcriptsData([a, b])
    expect(data.runs.map((run) => run.name)).toEqual(['qwen label', 'parakeet label'])
    expect(data.utterances.map((utterance) => utterance.id)).toEqual(['u1', 'u2'])
    const [qwen, parakeet] = data.utterances[0]!.heard
    expect(qwen).toMatchObject({ text: 'こんばんは', errors: 2, referenceLength: 5 })
    expect(parakeet).toMatchObject({ errors: 0 })
    expect(data.utterances[1]!.heard[1]).toEqual({ droppedBy: 'no-voice' })
    expect(data.runs[1]).toMatchObject({ dropped: 1, errorRate: 0 })
  })

  it('lines up what was heard with the readings and accepted spellings of an annotated sentence', () => {
    const spellings = path.join(folder, 'spellings')
    fs.mkdirSync(spellings)
    fs.writeFileSync(path.join(spellings, 'test-ja-JP.jsonl'), JSON.stringify({ line: '今日《きょう》は［九《く》時《じ》／9時］', by: 'test', skill: 'test', at: '2026-10-02' }) + '\n')
    const a = writeRun('asr-a', 'qwen', 'fleurs-ja', [['u1', '今日は九時', 'きょうは9時'], ['u2', 'こんにちは', 'こんにちは']])
    const data = transcriptsData([a], (locale) => readSpellings(locale, spellings))
    const [heard] = data.utterances[0]!.heard
    expect(heard).toMatchObject({ errors: 4, accepted: { errors: 0 } })
    expect(data.utterances[1]!.heard[0]).toMatchObject({ accepted: null })
    expect(data.runs[0]).toMatchObject({ annotated: 1, acceptedErrorRate: null })
    expect(data.annotated).toBe(true)
  })

  it('stops at runs that heard different sets, whose utterances do not line up', () => {
    const a = writeRun('asr-a', 'qwen', 'fleurs-ja', [['u1', 'はい', 'はい']])
    const b = writeRun('asr-b', 'qwen', 'recordings-ja', [['u1', 'はい', 'はい']])
    expect(() => transcriptsData([a, b])).toThrow()
  })
})
