import type { AsrModel } from '../catalog/models.ts'
import { languageOf } from '../core/language.ts'
import { encodeWav16, type Pcm } from '../core/wav.ts'
import type { AsrEngine, Transcription } from './engine.ts'
import { startServer, stopServer, waitUntilHealthy, type RunningServer } from './server.ts'

/**
 * The engine settings `nemo-speech serve` is started with for a FastConformer model, which the result records. The
 * server batches the work of concurrent requests by default and waits up to 5 ms at each neural stage for more
 * (v0.2.0); one request at a time would wait for nothing, so batching is off, as NeMo-Speech.cpp leaves it for a single
 * caller of its library.
 */
export const NEMO_SPEECH_LOAD_OPTIONS: Readonly<Record<string, string>> = { 'asr.batching.enabled': 'false' }

/**
 * The engine settings `nemo-speech serve` is started with for a speech-LLM, which the result records. The engine
 * decodes up to 16 requests at once by default, and on Metal, as on every path but CUDA's batched one, reserves each
 * slot's recurrent state, about 48 MiB, and its share of the KV pool, 8,192 tokens, when it starts (NeMo-Speech.cpp
 * 66d50d91). The bench sends one request at a time, so it asks for one slot, with a pool as long as the engine's
 * longest request by default, 73,728 tokens or an hour of audio, as NeMo-Speech.cpp's guide advises for a laptop.
 */
export const NEMO_SPEECH_SALM_LOAD_OPTIONS: Readonly<Record<string, string>> = { 'asr.salm.max_sequences': '1', 'asr.salm.n_ctx_per_sequence': '73728' }

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
 * Starts `nemo-speech serve` on the model file with the engine settings given, and waits until it is ready for speech
 * recognition on the device. The server's own warm-up is left out, so that the load time is the loading alone, as for
 * speech.cpp's worker; the run's first utterance, run once untimed, pays for the GPU's first use.
 */
async function startNemoSpeech(name: string, executable: string, file: string, device: string, options: Readonly<Record<string, string>>): Promise<RunningServer> {
  const server = await startServer(name, executable, (port) => [
    'serve', '--asr-model', file, '--device', device, '--host', '127.0.0.1', '--port', String(port), '--no-ui', '--no-warmup',
    ...Object.entries(options).map(([key, value]) => `--${key}=${value}`)
  ], withoutNemoSpeechSettings(process.env))
  const ready = (await (await waitUntilHealthy(server, `http://127.0.0.1:${server.port}/ready`)).json()) as { device?: unknown; capabilities?: unknown }
  if (ready.device !== device || !Array.isArray(ready.capabilities) || !ready.capabilities.includes('asr')) {
    throw new Error(`NeMo-Speech.cpp is ready with ${JSON.stringify(ready)}, not with speech recognition on ${device}; see ${server.log}`)
  }
  return server
}

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

  get pid(): number | null {
    return this.server?.child.pid ?? null
  }

  async start(): Promise<void> {
    this.server = await startNemoSpeech(this.model.id, this.executable, this.file, this.device, NEMO_SPEECH_LOAD_OPTIONS)
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

/**
 * The body of a chat completion that asks NeMo-Speech.cpp's speech-LLM to transcribe a WAVE file with an instruction:
 * one user message of the instruction and the audio, decoded greedily. The server writes the instruction before the
 * audio, `<instruction> <|audio|>`, and takes no language with it.
 */
export function salmChatRequest(model: string, instruction: string, wav: Buffer): Record<string, unknown> {
  return {
    model,
    temperature: 0,
    messages: [{ role: 'user', content: [{ type: 'text', text: instruction }, { type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } }] }]
  }
}

/**
 * The transcript of NeMo-Speech.cpp's answer to a chat completion, one choice finished with `stop`, which the server
 * gives whether the model ended the transcript or the request reached its budget of new tokens, 32 and 10 for each
 * second of audio (NeMo-Speech.cpp 66d50d91).
 */
export function salmTranscript(body: string): string {
  const answer = JSON.parse(body) as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] }
  const [choice, ...others] = answer.choices ?? []
  if (!choice || others.length > 0) throw new Error(`NeMo-Speech.cpp answered with ${answer.choices?.length ?? 0} choices, not one: ${body.slice(0, 300)}`)
  if (choice.finish_reason !== 'stop') throw new Error(`NeMo-Speech.cpp finished the transcript with ${JSON.stringify(choice.finish_reason)}, not stop: ${body.slice(0, 300)}`)
  if (typeof choice.message?.content !== 'string') throw new Error(`NeMo-Speech.cpp answered without a transcript: ${body.slice(0, 300)}`)
  return choice.message.content.trim()
}

/**
 * A speech-LLM in NeMo-Speech.cpp's HTTP server, the build that has SALM, asked through its chat completions with the
 * catalog's instruction and the utterance whole, timed from sending the request to reading the answer. The language is
 * never sent: with an instruction the server takes none, and the catalog's instruction names the language as spoken.
 */
export class NemoSpeechSalmAsr implements AsrEngine {
  private server: RunningServer | null = null
  private served: string | null = null
  private readonly executable: string
  private readonly model: Extract<AsrModel, { family: 'salm' }>
  private readonly decoder: string
  private readonly device: string

  constructor(executable: string, model: Extract<AsrModel, { family: 'salm' }>, decoder: string, device: string) {
    this.executable = executable
    this.model = model
    this.decoder = decoder
    this.device = device
  }

  get log(): string | null {
    return this.server?.log ?? null
  }

  get pid(): number | null {
    return this.server?.child.pid ?? null
  }

  /** Starts the server, and takes the id it serves the model under, which every chat completion names. */
  async start(): Promise<void> {
    this.server = await startNemoSpeech(this.model.id, this.executable, this.decoder, this.device, NEMO_SPEECH_SALM_LOAD_OPTIONS)
    const response = await fetch(`http://127.0.0.1:${this.server.port}/v1/models`)
    const text = await response.text()
    if (!response.ok) throw new Error(`NeMo-Speech.cpp's /v1/models answered ${response.status}: ${text.slice(0, 300)}`)
    const listed = (JSON.parse(text) as { data?: { id?: unknown; capability?: unknown }[] }).data ?? []
    const transcribing = listed.filter((entry) => entry.capability === 'transcription' && typeof entry.id === 'string')
    if (transcribing.length !== 1) throw new Error(`NeMo-Speech.cpp serves ${transcribing.length} transcription models, not the one it was started with: ${text.slice(0, 300)}`)
    this.served = transcribing[0]!.id as string
  }

  async transcribe(pcm: Pcm): Promise<Transcription> {
    if (!this.server || this.served === null) throw new Error('the server is not started')
    const body = JSON.stringify(salmChatRequest(this.served, this.model.instruction, encodeWav16(pcm)))
    const started = performance.now()
    const response = await fetch(`http://127.0.0.1:${this.server.port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    const text = await response.text()
    const seconds = (performance.now() - started) / 1000
    if (!response.ok) throw new Error(`NeMo-Speech.cpp answered ${response.status}: ${text.slice(0, 300)}`)
    return { text: salmTranscript(text), seconds }
  }

  async stop(): Promise<void> {
    if (this.server) await stopServer(this.server)
  }
}
