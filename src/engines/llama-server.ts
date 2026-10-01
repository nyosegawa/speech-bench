import { randomBytes } from 'node:crypto'
import type { AsrModel } from '../catalog/models.ts'
import { ENGLISH_LANGUAGE_NAMES, languageOf } from '../core/language.ts'
import { encodeWav16, type Pcm } from '../core/wav.ts'
import type { AsrEngine, Transcription } from './engine.ts'
import { startServer, stopServer, waitUntilHealthy, type RunningServer } from './server.ts'

/** The start of Qwen3-ASR's answer, which names the language before the transcription. */
const LANGUAGE_PREFIX = /^language\s+\S+?<asr_text>/

/** Removes the language Qwen3-ASR writes before its transcription. */
export const stripLanguagePrefix = (answer: string): string => answer.replace(LANGUAGE_PREFIX, '').trim()

/**
 * Qwen3-ASR in llama-server, one request at a time with every layer on the GPU, asked with the answer begun
 * as `language <Name><asr_text>`, which fixes the language instead of leaving the model to detect it.
 */
export class LlamaServerAsr implements AsrEngine {
  private server: RunningServer | null = null
  private readonly key = randomBytes(24).toString('hex')
  private readonly executable: string
  private readonly model: AsrModel
  private readonly files: readonly string[]
  private readonly device: string

  constructor(executable: string, model: AsrModel, files: readonly string[], device: string) {
    this.executable = executable
    this.model = model
    this.files = files
    this.device = device
  }

  get log(): string | null {
    return this.server?.log ?? null
  }

  async start(): Promise<void> {
    const [gguf, mmproj] = this.files
    if (!gguf || !mmproj) throw new Error(`${this.model.id} needs a model file and an audio projector`)
    this.server = await startServer(this.model.id, this.executable, (port) => [
      '--model', gguf,
      '--mmproj', mmproj,
      '--device', this.device,
      '--n-gpu-layers', '99',
      '--ctx-size', '4096',
      '--parallel', '1',
      '--host', '127.0.0.1',
      '--port', String(port),
      '--api-key', this.key,
      '--no-webui',
      '--offline',
      '--log-colors', 'off'
    ])
    await waitUntilHealthy(this.server, `http://127.0.0.1:${this.server.port}/health`)
  }

  async transcribe(pcm: Pcm, locale: string): Promise<Transcription> {
    if (!this.server) throw new Error('the server is not started')
    const language = ENGLISH_LANGUAGE_NAMES[languageOf(locale)]
    if (!language) throw new Error(`no English name for the language of ${locale}`)
    const body = JSON.stringify({
      messages: [
        { role: 'user', content: [{ type: 'input_audio', input_audio: { data: encodeWav16(pcm).toString('base64'), format: 'wav' } }] },
        { role: 'assistant', content: `language ${language}<asr_text>` }
      ],
      temperature: 0,
      max_tokens: 512
    })
    const started = performance.now()
    const response = await fetch(`http://127.0.0.1:${this.server.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
      body
    })
    const text = await response.text()
    const seconds = (performance.now() - started) / 1000
    if (!response.ok) throw new Error(`llama-server answered ${response.status}: ${text.slice(0, 300)}`)
    const content = (JSON.parse(text) as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error(`llama-server answered without a transcription: ${text.slice(0, 300)}`)
    return { text: stripLanguagePrefix(content), seconds }
  }

  async stop(): Promise<void> {
    if (this.server) await stopServer(this.server)
  }
}
