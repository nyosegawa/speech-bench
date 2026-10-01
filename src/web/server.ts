import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { SPEAKER_MODEL } from '../catalog/models.ts'
import { dataDir } from '../core/paths.ts'
import { readWav } from '../core/wav.ts'
import { SpeakerEmbedder } from '../engines/speaker-embedding.ts'
import { referenceFile, referenceNames } from '../make/references.ts'
import { listCampaigns } from '../measure/campaigns.ts'
import { summarize } from '../measure/report.ts'
import { allRunFiles, runFile, runIdOf } from '../measure/runs.ts'
import { listeningData, readTtsRuns, type UrlOf } from '../pages/listen.ts'
import type { ApiError, CampaignRow, ListenData, RunRow } from './api.ts'

/** The built web app, which `npm run web:build` writes. */
const APP = path.join(import.meta.dirname, '..', '..', 'web', 'dist')

const TYPES: Readonly<Record<string, string>> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.json': 'application/json' }

/** The route an audio file of the data folder is served at. */
export const audioUrl: UrlOf = (file) => `/audio/${path.relative(dataDir(), file).split(path.sep).map(encodeURIComponent).join('/')}`

/** The data folder's file a route names, or null for one outside it or not a WAVE file. */
export function audioFileOf(route: string): string | null {
  const relative = route.slice('/audio/'.length).split('/').map(decodeURIComponent)
  const file = path.resolve(dataDir(), ...relative)
  return file.startsWith(path.resolve(dataDir()) + path.sep) && file.endsWith('.wav') ? file : null
}

class RequestError extends Error {}

const json = (response: http.ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

function runRows(): RunRow[] {
  const campaignsOf = new Map<string, string[]>()
  for (const campaign of listCampaigns()) for (const run of campaign.runs) campaignsOf.set(run, [...(campaignsOf.get(run) ?? []), campaign.name])
  return allRunFiles().map((file) => ({ ...summarize(fs.readFileSync(file, 'utf8').split('\n')), id: runIdOf(file), campaigns: campaignsOf.get(runIdOf(file)) ?? [] }))
}

/**
 * The bench's web server on the loopback interface: the API the web app reads, the audio of the data folder,
 * and the built app itself, which takes every other path so that its own routes load.
 */
export async function startWebServer(port: number): Promise<{ url: string; close: () => void }> {
  let embedder: Promise<SpeakerEmbedder> | null = null
  const speakerEmbedder = (): Promise<SpeakerEmbedder> => (embedder ??= SpeakerEmbedder.open(SPEAKER_MODEL))
  const referenceEmbeddings = new Map<string, Float32Array>()

  async function listen(url: URL): Promise<ListenData> {
    const ids = (url.searchParams.get('runs') ?? '').split(',').filter(Boolean)
    if (ids.length === 0) throw new RequestError('name the runs to listen to with runs=a,b')
    const files = ids.map(runFile)
    const missing = files.filter((file) => !fs.existsSync(file))
    if (missing.length > 0) throw new RequestError(`there are no runs ${missing.map(runIdOf).join(', ')}`)
    const shared = await speakerEmbedder()
    const reference = url.searchParams.get('reference')
    const embeddingOf = (name: string): Float32Array => {
      const known = referenceEmbeddings.get(name) ?? shared.embed(readWav(fs.readFileSync(referenceFile(name))))
      referenceEmbeddings.set(name, known)
      return known
    }
    const runs = readTtsRuns(files, shared, () => true, (run) => {
      const name = reference ?? run.reference?.name
      return name === undefined ? undefined : embeddingOf(name)
    })
    if (runs.length === 0) throw new RequestError('the runs named are not speech synthesis runs')
    return listeningData(runs, audioUrl, url.searchParams.get('blind') === '1', Math.random, reference)
  }

  function serveFile(response: http.ServerResponse, file: string): void {
    response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'content-length': fs.statSync(file).size })
    fs.createReadStream(file).pipe(response)
  }

  function serveApp(response: http.ServerResponse, pathname: string): void {
    if (!fs.existsSync(path.join(APP, 'index.html'))) {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('The web app is not built; run "npm run web:build" in the bench, then reload.')
      return
    }
    const asset = path.resolve(APP, `.${pathname}`)
    const isAsset = asset.startsWith(APP + path.sep) && fs.existsSync(asset) && fs.statSync(asset).isFile()
    serveFile(response, isAsset ? asset : path.join(APP, 'index.html'))
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    void (async () => {
      if (request.method === 'GET' && url.pathname === '/api/runs') return json(response, 200, runRows())
      if (request.method === 'GET' && url.pathname === '/api/campaigns') return json(response, 200, listCampaigns() satisfies CampaignRow[])
      if (request.method === 'GET' && url.pathname === '/api/listen') return json(response, 200, await listen(url))
      if (request.method === 'GET' && url.pathname === '/api/references') return json(response, 200, referenceNames(''))
      if (url.pathname.startsWith('/api/')) throw new RequestError(`there is no route ${request.method} ${url.pathname}`)
      if (request.method === 'GET' && url.pathname.startsWith('/audio/')) {
        const file = audioFileOf(url.pathname)
        if (!file || !fs.existsSync(file)) throw new RequestError(`there is no audio at ${url.pathname}`)
        return serveFile(response, file)
      }
      if (request.method === 'GET') return serveApp(response, url.pathname)
      throw new RequestError(`there is no route ${request.method} ${url.pathname}`)
    })().catch((error: unknown) => {
      const status = error instanceof RequestError ? 400 : 500
      json(response, status, { error: error instanceof Error ? error.message : String(error) } satisfies ApiError)
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address() as { port: number }
      resolve({ url: `http://127.0.0.1:${address.port}/`, close: () => server.close() })
    })
  })
}
