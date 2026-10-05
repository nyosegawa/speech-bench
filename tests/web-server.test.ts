import fs from 'node:fs'
import http from 'node:http'
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

/** A request with headers fetch would not send, such as another Host. */
function rawRequest(route: string, options: { method?: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(`${server.url}${route}`, { method: options.method ?? 'GET', headers: options.headers }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode!, body }))
    })
    request.on('error', reject)
    request.end(options.body)
  })
}

function writeRun(id: string): void {
  fs.mkdirSync(path.dirname(runFile(id)), { recursive: true })
  fs.copyFileSync(path.join(import.meta.dirname, 'fixtures', 'result-file', 'v12-tts.jsonl'), runFile(id))
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

  it('refuses requests addressed to another host, which a site pointed at this computer would send', async () => {
    writeRun('tts-a')
    const answer = await rawRequest('api/runs', { headers: { host: 'attacker.example:5280' } })
    expect(answer.status).toBe(400)
    expect(answer.body).not.toContain('tts-a')
  })

  it('refuses a choice sent as plain text, which a page of another site can send unasked', async () => {
    const answer = await rawRequest('api/voices/calm/choose', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ locale: 'ja-JP', candidate: 'calm-candidate-1' }) })
    expect(answer.status).toBe(400)
  })

  it('saves a recording sent as a WAVE file, and lists the speaker with it', async () => {
    const saved = await fetch(`${server.url}api/recordings/ja-JP/guest/greeting`, { method: 'POST', headers: { 'content-type': 'audio/wav', 'x-recording-text': encodeURIComponent('こんにちは。') }, body: take })
    expect(saved.status).toBe(200)
    const rows = (await (await fetch(`${server.url}api/recordings`)).json()) as Array<{ locale: string; speaker: string; recordings: number }>
    expect(rows).toEqual([{ locale: 'ja-JP', speaker: 'guest', recordings: 1 }])
  })

  it('refuses a recording sent as plain text, which a page of another site can send unasked', async () => {
    const answer = await rawRequest('api/recordings/ja-JP/guest/greeting', { method: 'POST', headers: { 'content-type': 'text/plain', 'x-recording-text': 'x' }, body: 'RIFF' })
    expect(answer.status).toBe(400)
    expect(fs.existsSync(path.join(root, 'data', 'recordings'))).toBe(false)
  })
})
