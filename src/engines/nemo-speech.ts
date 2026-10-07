import type { AsrModel } from '../catalog/models.ts'
import { languageOf } from '../core/language.ts'
import { encodeWav16, type Pcm } from '../core/wav.ts'
import type { AsrEngine, Transcription } from './engine.ts'
import { startServer, stopServer, waitUntilHealthy, type RunningServer } from './server.ts'

/**
 * The engine settings `nemo-speech serve` is started with, which the result records. The server batches the work of
 * concurrent requests by default and waits up to 5 ms at each neural stage for more (v0.2.0); one request at a time
 * would wait for nothing, so batching is off, as NeMo-Speech.cpp leaves it for a single caller of its library.
 */
export const NEMO_SPEECH_LOAD_OPTIONS: Readonly<Record<string, string>> = { 'asr.batching.enabled': 'false' }

/**
 * The device `nemo-speech serve` is told for ggml's name of the bench's GPU: `metal` for MTL0 and `vulkan:N` for
 * VulkanN, both of which count the GPUs ggml lists from 0. A device it cannot start stops the server rather than
 * leaving the model on the CPU (v0.2.0).
 */
export function nemoSpeechDevice(ggmlDevice: string): string {
  if (ggmlDevice === 'MTL0') return 'metal'
  const vulkan = /^Vulkan(\d+)$/.exec(ggmlDevice)
  if (vulkan) return `vulkan:${vulkan[1]}`
  throw new Error(`NeMo-Speech.cpp runs on metal or vulkan:N, and the bench's GPU is ${ggmlDevice}; set SPEECH_BENCH_DEVICE to MTL0 or VulkanN`)
}

/**
 * The bench's environment without the variables NeMo-Speech.cpp reads its engine settings from, NEMO_SPEECH_<KEY>,
 * any of which would change what is measured without the result's saying so: a punctuation model, inverse text
 * normalization or masking of silence by a VAD.
 */
export const withoutNemoSpeechSettings = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !name.toUpperCase().startsWith('NEMO_SPEECH_')))

/**
 * A FastConformer model in NeMo-Speech.cpp's HTTP server, asked through its OpenAI-compatible transcription endpoint
 * with the utterance whole, as CrispASR is. The model's text comes back as it writes it: `automatic_punctuation` left
 * off would lowercase it and drop the punctuation it writes, and `verbatim` keeps inverse text normalization out.
 */
export class NemoSpeechAsr implements AsrEngine {
  private server: RunningServer | null = null
  private readonly executable: string
  private readonly model: AsrModel
  private readonly file: string
  private readonly device: string

  constructor(executable: string, model: AsrModel, file: string, device: string) {
    this.executable = executable
    this.model = model
    this.file = file
    this.device = device
  }

  get log(): string | null {
    return this.server?.log ?? null
  }

  async start(): Promise<void> {
    // The server's own warm-up is left out, so that the load time is the loading alone, as for speech.cpp's worker;
    // the run's first utterance, run once untimed, pays for the GPU's first use.
    this.server = await startServer(this.model.id, this.executable, (port) => [
      'serve', '--asr-model', this.file, '--device', this.device, '--host', '127.0.0.1', '--port', String(port), '--no-ui', '--no-warmup',
      ...Object.entries(NEMO_SPEECH_LOAD_OPTIONS).map(([key, value]) => `--${key}=${value}`)
    ], withoutNemoSpeechSettings(process.env))
    const ready = (await (await waitUntilHealthy(this.server, `http://127.0.0.1:${this.server.port}/ready`)).json()) as { device?: unknown; capabilities?: unknown }
    if (ready.device !== this.device || !Array.isArray(ready.capabilities) || !ready.capabilities.includes('asr')) {
      throw new Error(`NeMo-Speech.cpp is ready with ${JSON.stringify(ready)}, not with speech recognition on ${this.device}; see ${this.server.log}`)
    }
  }

  async transcribe(pcm: Pcm, locale: string): Promise<Transcription> {
    if (!this.server) throw new Error('the server is not started')
    const form = new FormData()
    form.append('file', new Blob([encodeWav16(pcm)], { type: 'audio/wav' }), 'utterance.wav')
    form.append('response_format', 'json')
    form.append('automatic_punctuation', 'true')
    form.append('verbatim', 'true')
    if (this.model.languageHint !== 'none') form.append('language', languageOf(locale))
    const started = performance.now()
    const response = await fetch(`http://127.0.0.1:${this.server.port}/v1/audio/transcriptions`, { method: 'POST', body: form })
    const text = await response.text()
    const seconds = (performance.now() - started) / 1000
    if (!response.ok) throw new Error(`NeMo-Speech.cpp answered ${response.status}: ${text.slice(0, 300)}`)
    const transcript = (JSON.parse(text) as { text?: unknown }).text
    if (typeof transcript !== 'string') throw new Error(`NeMo-Speech.cpp answered without a transcription: ${text.slice(0, 300)}`)
    return { text: transcript.trim(), seconds }
  }

  async stop(): Promise<void> {
    if (this.server) await stopServer(this.server)
  }
}
