import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { joinCampaign } from '../src/measure/campaigns.ts'
import { runFile } from '../src/measure/runs.ts'
import { voiceCampaign, voiceRuns } from '../src/make/voice.ts'

let data: string
beforeEach(() => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-test-'))
  process.env.SPEECH_BENCH_DATA = data
})
afterEach(() => {
  delete process.env.SPEECH_BENCH_DATA
  fs.rmSync(data, { recursive: true, force: true })
})

function writeRun(id: string, run: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(runFile(id)), { recursive: true })
  fs.writeFileSync(runFile(id), `${JSON.stringify({ type: 'run', format: 12, set: { name: 'speak', locale: 'ja-JP', size: 1 }, ...run })}\n`)
}

describe('voiceRuns', () => {
  it('tells the takes gathered from the description from the tries of its candidates', () => {
    writeRun('gathered', { task: 'tts', design: { id: 'calm', instruction: '落ち着いた声' }, reference: null })
    writeRun('tried', { task: 'tts', design: null, reference: { name: 'calm-candidate-1', sha256: 'a'.repeat(64), seconds: 10 } })
    joinCampaign(voiceCampaign('calm'), 'gathered')
    joinCampaign(voiceCampaign('calm'), 'tried')
    expect(voiceRuns('calm')).toEqual({ gathered: [runFile('gathered')], tried: [runFile('tried')] })
  })

  it('has no runs for a voice no run has joined', () => {
    expect(voiceRuns('calm')).toEqual({ gathered: [], tried: [] })
  })

  it('stops at a recognition run in a voice campaign rather than count it as a take', () => {
    writeRun('asr', { task: 'asr', audio: { edges: 'as-recorded', trailingSilence: 0 } })
    joinCampaign(voiceCampaign('calm'), 'asr')
    expect(() => voiceRuns('calm')).toThrow()
  })
})
