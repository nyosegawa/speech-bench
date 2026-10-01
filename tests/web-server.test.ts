import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encodeWav16 } from '../src/core/wav.ts'
import { joinCampaign } from '../src/measure/campaigns.ts'
import { runFile } from '../src/measure/runs.ts'
import type { RunRow } from '../src/web/api.ts'
import { startWebServer } from '../src/web/server.ts'

let root: string
let server: { url: string; close: () => void }
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-web-'))
  process.env.SPEECH_BENCH_DATA = path.join(root, 'data')
  server = await startWebServer(0)
})
afterEach(() => {
  server.close()
  delete process.env.SPEECH_BENCH_DATA
  fs.rmSync(root, { recursive: true, force: true })
})

const take = encodeWav16({ sampleRate: 16_000, samples: new Float32Array(1_600) })

function writeRun(id: string): void {
  fs.mkdirSync(path.dirname(runFile(id)), { recursive: true })
  fs.copyFileSync(path.join(import.meta.dirname, 'fixtures', 'result-format-11-tts.jsonl'), runFile(id))
  fs.writeFileSync(path.join(path.dirname(runFile(id)), 'take.wav'), take)
}

describe('the web server', () => {
  it('lists each run with the campaigns it joined', async () => {
    writeRun('tts-a')
    writeRun('tts-b')
    joinCampaign('voices', 'tts-b')
    const rows = (await (await fetch(`${server.url}api/runs`)).json()) as RunRow[]
    expect(rows.map((row) => [row.id, row.campaigns])).toEqual([['tts-a', []], ['tts-b', ['voices']]])
  })

  it('serves the audio of the data folder and nothing outside it or other than audio', async () => {
    writeRun('tts-a')
    fs.writeFileSync(path.join(root, 'outside.wav'), take)
    const inside = await fetch(`${server.url}audio/runs/tts-a/take.wav`)
    expect(inside.status).toBe(200)
    expect(Buffer.from(await inside.arrayBuffer())).toEqual(take)
    expect((await fetch(`${server.url}audio/..%2Foutside.wav`)).status).toBe(400)
    expect((await fetch(`${server.url}audio/runs/tts-a/run.jsonl`)).status).toBe(400)
  })
})
