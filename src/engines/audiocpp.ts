import fs from 'node:fs'
import path from 'node:path'
import type { TtsModel } from '../catalog.ts'
import { logsDir } from '../paths.ts'
import { readWav } from '../wav.ts'
import { startServer, stopServer, waitUntilHealthy, type RunningServer } from './server.ts'
import type { Synthesis, TtsEngine } from './tts-engine.ts'

type Model = Extract<TtsModel, { runtime: 'audio.cpp' }>

/**
 * The server configuration for one model, in audio.cpp's format; the host and port come from its command line.
 * The run's own options (a seed, a voice description) join the model's in the options every request starts
 * from, so that every sentence of the run is sampled with them; without a seed audio.cpp picks a random one
 * for each request. A reference voice is the model's default voice preset, which the server gives every
 * request, and turns the model's no-reference generation off.
 */
export function audioCppConfig(model: Model, file: string, backend: 'metal' | 'vulkan', runOptions: Readonly<Record<string, unknown>>, reference: string | null): Record<string, unknown> {
  const options = { ...model.options, ...runOptions, ...(reference === null ? {} : { no_ref: false }) }
  const entry = { id: model.id, family: model.family, path: file, task: 'tts', mode: 'offline', session_options: model.loadOptions[backend] ?? {}, default_request_options: options }
  return {
    backend,
    device: 0,
    lazy_load: false,
    models: [reference === null ? entry : { ...entry, default_voice_preset: { voice_ref: reference } }]
  }
}

/**
 * A model in audio.cpp's server, asked through its OpenAI-compatible speech endpoint. The families measured
 * here synthesize a whole sentence before answering, so the first audio arrives with the last.
 */
export class AudioCppTts implements TtsEngine {
  private server: RunningServer | null = null
  private readonly executable: string
  private readonly model: Model
  private readonly file: string
  private readonly backend: 'metal' | 'vulkan'
  private readonly runOptions: Readonly<Record<string, unknown>>
  private readonly reference: string | null

  constructor(executable: string, model: Model, file: string, backend: 'metal' | 'vulkan', runOptions: Readonly<Record<string, unknown>>, reference: string | null) {
    this.executable = executable
    this.model = model
    this.file = file
    this.backend = backend
    this.runOptions = runOptions
    this.reference = reference
  }

  get log(): string | null {
    return this.server?.log ?? null
  }

  async start(): Promise<void> {
    fs.mkdirSync(logsDir(), { recursive: true })
    const config = path.join(logsDir(), `${this.model.id}-server.json`)
    fs.writeFileSync(config, JSON.stringify(audioCppConfig(this.model, this.file, this.backend, this.runOptions, this.reference), null, 2))
    this.server = await startServer(this.model.id, this.executable, (port) => ['--config', config, '--host', '127.0.0.1', '--port', String(port), '--no-ui'])
    await waitUntilHealthy(this.server, `http://127.0.0.1:${this.server.port}/health`)
  }

  async synthesize(text: string, _locale: string, voice: string | null): Promise<Synthesis> {
    if (!this.server) throw new Error('the server is not started')
    if (voice !== null) throw new Error(`${this.model.id} is measured without a voice`)
    const started = performance.now()
    const response = await fetch(`http://127.0.0.1:${this.server.port}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model.id, input: text, response_format: 'wav' })
    })
    const body = Buffer.from(await response.arrayBuffer())
    const totalSeconds = (performance.now() - started) / 1000
    if (!response.ok) throw new Error(`audio.cpp answered ${response.status}: ${body.toString('utf8').slice(0, 300)}`)
    return { pcm: readWav(body), firstAudioSeconds: totalSeconds, totalSeconds }
  }

  async stop(): Promise<void> {
    if (this.server) await stopServer(this.server)
  }
}
