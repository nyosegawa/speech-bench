import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { readManifest, recordingFile, saveRecording, type RecordingFolder } from '../datasets/recordings.ts'
import type { Prompt } from '../datasets/prompts.ts'

const PAGE = path.join(import.meta.dirname, 'page.html')

/** A recording is at most this large: 60 s of 16 kHz 16-bit audio, with room for the header. */
const MAX_BODY_BYTES = 60 * 16_000 * 2 + 1_024

function readBody(request: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('the recording is longer than 60 s'))
        request.destroy()
      } else {
        chunks.push(chunk)
      }
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

const send = (response: http.ServerResponse, status: number, type: string, body: string | Buffer): void => {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  response.end(body)
}

/**
 * The recording page and the requests it makes, on the loopback interface only: the prompts with the ids
 * already recorded, a saved recording's audio for playback, and saving a recording.
 */
export function startRecordingServer(folder: RecordingFolder, prompts: readonly Prompt[]): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    void (async () => {
      if (request.method === 'GET' && url.pathname === '/') return send(response, 200, 'text/html; charset=utf-8', fs.readFileSync(PAGE))
      if (request.method === 'GET' && url.pathname === '/state') {
        const recorded = readManifest(folder)
        return send(response, 200, 'application/json', JSON.stringify({ locale: folder.locale, speaker: folder.speaker, prompts, recorded }))
      }
      const audio = /^\/recordings\/([a-z0-9_-]+)\.wav$/.exec(url.pathname)
      if (request.method === 'GET' && audio) {
        const entry = readManifest(folder).find((recorded) => recorded.id === audio[1])
        if (!entry) return send(response, 404, 'text/plain', 'no such recording')
        return send(response, 200, 'audio/wav', fs.readFileSync(recordingFile(folder, entry)))
      }
      if (request.method === 'POST' && url.pathname === '/recordings') {
        // The text travels in a header, URI-encoded, because the body is the WAVE file itself.
        const id = String(request.headers['x-recording-id'] ?? '')
        const text = decodeURIComponent(String(request.headers['x-recording-text'] ?? ''))
        const entry = saveRecording(folder, id, text, await readBody(request))
        return send(response, 200, 'application/json', JSON.stringify(entry))
      }
      send(response, 404, 'text/plain', 'not found')
    })().catch((error: unknown) => send(response, 400, 'text/plain', error instanceof Error ? error.message : String(error)))
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => server.close() })
    })
  })
}
