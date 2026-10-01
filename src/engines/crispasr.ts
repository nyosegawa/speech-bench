import type { AsrModel } from '../catalog/models.ts'
import { languageOf } from '../core/language.ts'
import { encodeWav16, type Pcm } from '../core/wav.ts'
import type { AsrEngine, Transcription } from './engine.ts'
import { startServer, stopServer, waitUntilHealthy, type RunningServer } from './server.ts'

/**
 * A model in CrispASR's HTTP server, asked through its OpenAI-compatible transcription endpoint. The
 * backend CrispASR picks from the GGUF is checked against the one the catalog names, so that a file
 * loaded as the wrong model fails the run instead of producing numbers for something else.
 */
export class CrispAsr implements AsrEngine {
  private server: RunningServer | null = null
  private readonly executable: string
  private readonly model: Extract<AsrModel, { runtime: 'crispasr' }>
  private readonly file: string

  constructor(executable: string, model: Extract<AsrModel, { runtime: 'crispasr' }>, file: string) {
    this.executable = executable
    this.model = model
    this.file = file
  }

  get log(): string | null {
    return this.server?.log ?? null
  }

  async start(): Promise<void> {
    // CrispASR's detection from the GGUF loads the ReazonSpeech file as parakeet (v0.8.38), so the backend
    // is always named. Without a language CrispASR also detects it before every transcription, by running
    // Whisper tiny (downloaded on first use), which added its time to every measured wait (v0.8.38); none of
    // these models takes the detected language, so the detection is turned off.
    this.server = await startServer(this.model.id, this.executable, (port) => [
      '--server', '--backend', this.model.backend, '-m', this.file, '--lid-backend', 'off', '--host', '127.0.0.1', '--port', String(port)
    ])
    const health = await waitUntilHealthy(this.server, `http://127.0.0.1:${this.server.port}/health`)
    const backend = ((await health.json()) as { backend?: unknown }).backend
    if (backend !== this.model.backend) {
      throw new Error(`CrispASR loaded ${this.model.id} as ${String(backend)}, not ${this.model.backend}; see ${this.server.log}`)
    }
  }

  async transcribe(pcm: Pcm, locale: string): Promise<Transcription> {
    if (!this.server) throw new Error('the server is not started')
    const form = new FormData()
    form.append('file', new Blob([encodeWav16(pcm)], { type: 'audio/wav' }), 'utterance.wav')
    form.append('response_format', 'json')
    if (this.model.languageHint !== 'none') form.append('language', languageOf(locale))
    const started = performance.now()
    const response = await fetch(`http://127.0.0.1:${this.server.port}/v1/audio/transcriptions`, { method: 'POST', body: form })
    const text = await response.text()
    const seconds = (performance.now() - started) / 1000
    if (!response.ok) throw new Error(`CrispASR answered ${response.status}: ${text.slice(0, 300)}`)
    const transcript = (JSON.parse(text) as { text?: unknown }).text
    if (typeof transcript !== 'string') throw new Error(`CrispASR answered without a transcription: ${text.slice(0, 300)}`)
    return { text: transcript.trim(), seconds }
  }

  async stop(): Promise<void> {
    if (this.server) await stopServer(this.server)
  }
}
