import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { embedGroups, neighborGroups } from '../analysis/neighbors.ts'
import { SPEAKER_MODEL } from '../catalog/models.ts'
import { dataDir } from '../core/paths.ts'
import { readWav } from '../core/wav.ts'
import { SpeakerEmbedder } from '../engines/speaker-embedding.ts'
import { recipeLocales, recipeOf } from '../make/recipes.ts'
import { referenceFile, referenceNames } from '../make/references.ts'
import { listCampaigns } from '../measure/campaigns.ts'
import { summarize } from '../measure/report.ts'
import { allRunFiles, runFile, runIdOf } from '../measure/runs.ts'
import { listeningData, readTtsRuns, type UrlOf } from '../pages/listen.ts'
import { promptLocales } from '../datasets/prompts.ts'
import { transcriptsData } from '../pages/transcripts.ts'
import type { ApiError, CampaignRow, ChooseAnswer, ChosenVoices, Job, ListenData, NeighborsData, RecordingSession, RecordLocales, RunRow, SavedRecording, SpeakerRow, Transcripts, VoiceDetail, VoiceRow, VoiceStepRequest } from './api.ts'
import { folderOf, recordingSession, saveFrom, speakerRows } from './recordings.ts'
import { RequestError } from './request-error.ts'
import { Jobs } from './jobs.ts'
import { choose, chosenVoices, voiceDetail, voiceRows } from './voices.ts'

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

const json = (response: http.ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

const VOICE_STEPS: ReadonlyArray<VoiceStepRequest['step']> = ['gather', 'candidates', 'try']

/** A request's JSON body, which the bench's own app sends. */
async function bodyOf(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  // A page of another site can send a form or plain text here without asking; JSON it cannot send unasked.
  if (request.headers['content-type'] !== 'application/json') throw new RequestError('the request body must be sent as application/json')
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) return body as Record<string, unknown>
  } catch {
    // An unreadable body is answered as one that is not an object.
  }
  throw new RequestError('the request body is not a JSON object')
}

const textField = (body: Record<string, unknown>, name: string): string => {
  const value = body[name]
  if (typeof value !== 'string' || value === '') throw new RequestError(`the request body needs the string ${name}`)
  return value
}

const localeOf = (url: URL): string => {
  const locale = url.searchParams.get('locale')
  if (!locale) throw new RequestError('name the locale with locale=ja-JP')
  return locale
}

/** The result files of the runs a request names with runs=a,b, all of which must exist. */
function namedRuns(url: URL): string[] {
  const ids = (url.searchParams.get('runs') ?? '').split(',').filter(Boolean)
  if (ids.length === 0) throw new RequestError('name the runs with runs=a,b')
  const files = ids.map(runFile)
  const missing = files.filter((file) => !fs.existsSync(file))
  if (missing.length > 0) throw new RequestError(`there are no runs ${missing.map(runIdOf).join(', ')}`)
  return files
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
  const jobs = new Jobs()
  const referenceEmbedding = (embedder: SpeakerEmbedder) => (name: string): Float32Array => {
    const known = referenceEmbeddings.get(name) ?? embedder.embed(readWav(fs.readFileSync(referenceFile(name))))
    referenceEmbeddings.set(name, known)
    return known
  }

  async function listen(url: URL): Promise<ListenData> {
    const files = namedRuns(url)
    const shared = await speakerEmbedder()
    const reference = url.searchParams.get('reference')
    const embeddingOf = referenceEmbedding(shared)
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
      // A site whose name is made to point at this computer would otherwise read the data folder from the browser.
      const { port: listening } = server.address() as AddressInfo
      if (request.headers.host !== `127.0.0.1:${listening}` && request.headers.host !== `localhost:${listening}`) {
        throw new RequestError(`the bench answers only requests to 127.0.0.1:${listening}, not ${String(request.headers.host)}`)
      }
      if (request.method === 'GET' && url.pathname === '/api/runs') return json(response, 200, runRows())
      if (request.method === 'GET' && url.pathname === '/api/campaigns') return json(response, 200, listCampaigns() satisfies CampaignRow[])
      if (request.method === 'GET' && url.pathname === '/api/listen') return json(response, 200, await listen(url))
      if (request.method === 'GET' && url.pathname === '/api/transcripts') return json(response, 200, transcriptsData(namedRuns(url)) satisfies Transcripts)
      if (request.method === 'GET' && url.pathname === '/api/neighbors') {
        const groups = neighborGroups(embedGroups(namedRuns(url), await speakerEmbedder()), audioUrl)
        if (groups.length === 0) throw new RequestError('the runs hold no voice with two or more takes long enough to compare')
        return json(response, 200, groups satisfies NeighborsData)
      }
      if (request.method === 'GET' && url.pathname === '/api/references') return json(response, 200, referenceNames(''))
      if (request.method === 'GET' && url.pathname === '/api/voice-locales') return json(response, 200, recipeLocales())
      if (request.method === 'GET' && url.pathname === '/api/voices') return json(response, 200, voiceRows(localeOf(url)) satisfies VoiceRow[])
      if (request.method === 'GET' && url.pathname === '/api/voice-similarity') {
        const embedder = await speakerEmbedder()
        return json(response, 200, chosenVoices(localeOf(url), embedder, referenceEmbedding(embedder), audioUrl) satisfies ChosenVoices)
      }
      if (request.method === 'GET' && url.pathname === '/api/jobs') return json(response, 200, jobs.list() satisfies Job[])
      if (request.method === 'POST' && url.pathname === '/api/jobs') {
        const body = await bodyOf(request)
        const step = textField(body, 'step')
        if (!VOICE_STEPS.includes(step as VoiceStepRequest['step'])) throw new RequestError(`step is one of ${VOICE_STEPS.join(', ')}`)
        const locale = textField(body, 'locale')
        const voice = recipeOf(locale, textField(body, 'voice')).id
        return json(response, 200, jobs.start(`${step} ${voice}`, ['voice', step, voice, '--locale', locale]) satisfies Job)
      }
      const stop = /^\/api\/jobs\/([0-9TZ-]+)\/stop$/.exec(url.pathname)
      if (stop && request.method === 'POST') {
        await bodyOf(request)
        return json(response, 200, jobs.stop(stop[1]!) satisfies Job)
      }
      if (request.method === 'GET' && url.pathname === '/api/record-locales') return json(response, 200, promptLocales('record') satisfies RecordLocales)
      if (request.method === 'GET' && url.pathname === '/api/recordings') return json(response, 200, speakerRows() satisfies SpeakerRow[])
      const recordings = /^\/api\/recordings\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname)
      if (recordings) {
        const folder = folderOf(decodeURIComponent(recordings[1]!), decodeURIComponent(recordings[2]!))
        if (request.method === 'GET' && !recordings[3]) return json(response, 200, recordingSession(folder, audioUrl) satisfies RecordingSession)
        if (request.method === 'POST' && recordings[3]) return json(response, 200, (await saveFrom(request, folder, decodeURIComponent(recordings[3]), audioUrl)) satisfies SavedRecording)
      }
      const voice = /^\/api\/voices\/([a-z0-9_-]+)(\/choose)?$/.exec(url.pathname)
      if (voice && request.method === 'GET' && !voice[2]) {
        const embedder = await speakerEmbedder()
        return json(response, 200, voiceDetail(localeOf(url), voice[1]!, url.searchParams.get('tries'), embedder, referenceEmbedding(embedder), audioUrl) satisfies VoiceDetail)
      }
      if (voice && request.method === 'POST' && voice[2]) {
        const body = await bodyOf(request)
        return json(response, 200, (await choose(textField(body, 'locale'), voice[1]!, textField(body, 'candidate'))) satisfies ChooseAnswer)
      }
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
      const address = server.address() as AddressInfo
      resolve({ url: `http://127.0.0.1:${address.port}/`, close: () => server.close() })
    })
  })
}
