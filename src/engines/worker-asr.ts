import { randomUUID } from 'node:crypto'
import type { AsrModel } from '../catalog/models.ts'
import { languageOf } from '../core/language.ts'
import { encodePcm16, type Pcm } from '../core/wav.ts'
import type { AsrEngine, Transcription } from './engine.ts'
import { WorkerProcess, type WorkerCommand } from './worker.ts'

/**
 * Seconds of audio in each `chunk`. A caller that streams a microphone sends its audio in pieces as it comes; the
 * worker only collects them until `transcribe`, so their size changes the lines and not what is recognized.
 */
const CHUNK_SECONDS = 1

/** The stops of a recognition's `end`: the whole text, or the text up to the most tokens the model writes. */
const RECOGNITION_STOPS = new Set(['complete', 'model_limit'])

/** Whether the model's `language` steers it, as its model information declares the option. */
function languageSteers(model: Record<string, unknown>): boolean {
  const options: unknown[] = Array.isArray(model.options) ? model.options : []
  const language = options.find((option): option is Record<string, unknown> => typeof option === 'object' && option !== null && (option as Record<string, unknown>).name === 'language')
  if (!language || typeof language.steers !== 'boolean') throw new Error('the worker\'s model information declares no language option with whether it steers')
  return language.steers
}

/**
 * A speech recognition model behind speech.cpp's worker protocol 2. Each utterance is one request: its audio in
 * `chunk` messages of base64 16-bit PCM numbered from 0, at the rate it has, the samples a WAVE file sent to a server
 * holds, then `transcribe` with that rate and the language, answered with `progress` and one terminal message, `end`
 * with the text and its stop, `error` or `cancelled`. The language goes to every model: it steers Qwen3-ASR, which
 * writes it into its prompt as the llama-server engine begins the answer, and a model that cannot be told it only
 * checks it against its languages. The wait runs from writing the first chunk, once the lines are made, to reading
 * the `end`, as a server's runs from sending a request that holds the whole utterance.
 */
export class WorkerAsr implements AsrEngine {
  private readonly worker: WorkerProcess
  private readonly model: Pick<AsrModel, 'id' | 'languageHint'>

  constructor(command: WorkerCommand, model: Pick<AsrModel, 'id' | 'languageHint'>) {
    this.worker = new WorkerProcess(command)
    this.model = model
  }

  get log(): string | null {
    return this.worker.log
  }

  /** Starts the worker on a model that takes the language as the catalog says, so that a request means what it says. */
  async start(): Promise<void> {
    const steers = languageSteers(await this.worker.start())
    const told = this.model.languageHint === 'optional'
    if (steers !== told) {
      throw new Error(`the model file of ${this.model.id} says that its language ${steers ? 'steers it' : 'is only checked'}, and the catalog says that it ${told ? 'can' : 'cannot'} be told the language; correct languageHint in src/catalog/models.ts`)
    }
  }

  transcribe(pcm: Pcm, locale: string): Promise<Transcription> {
    const id = randomUUID()
    const data = encodePcm16(pcm.samples)
    const chunkBytes = pcm.sampleRate * CHUNK_SECONDS * 2
    const lines: string[] = []
    for (let offset = 0; offset < data.length; offset += chunkBytes) {
      lines.push(JSON.stringify({ type: 'chunk', id, seq: lines.length, pcm: data.subarray(offset, offset + chunkBytes).toString('base64') }))
    }
    lines.push(JSON.stringify({ type: 'transcribe', id, sample_rate: pcm.sampleRate, language: languageOf(locale) }))
    const started = performance.now()
    return this.worker.request(id, lines, {
      partway: (message) => {
        throw new Error(`the worker sent ${String(message.type)} for recognition request ${id}, which is answered with its end alone`)
      },
      end: (message) => {
        const seconds = (performance.now() - started) / 1000
        if (typeof message.text !== 'string') throw new Error(`the worker ended recognition request ${id} without a text`)
        if (typeof message.stop !== 'string' || !RECOGNITION_STOPS.has(message.stop)) throw new Error(`the worker ended recognition request ${id} with the stop ${JSON.stringify(message.stop)}, which a recognition does not have`)
        return { text: message.text.trim(), seconds }
      }
    })
  }

  stop(): Promise<void> {
    return this.worker.stop()
  }
}
