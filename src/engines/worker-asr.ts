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

/** An option the model's information declares, or undefined when the model does not take it. */
function declaredOption(model: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  const options: unknown[] = Array.isArray(model.options) ? model.options : []
  return options.find((option): option is Record<string, unknown> => typeof option === 'object' && option !== null && (option as Record<string, unknown>).name === name)
}

/** Whether the model's `language` steers it, as its model information declares the option. */
function languageSteers(model: Record<string, unknown>): boolean {
  const language = declaredOption(model, 'language')
  if (!language || typeof language.steers !== 'boolean') throw new Error('the worker\'s model information declares no language option with whether it steers')
  return language.steers
}

/** The decodings the model offers as the choices of its `decoding` option, none for a model with one decoding. */
function decodingChoices(model: Record<string, unknown>): unknown[] {
  const decoding = declaredOption(model, 'decoding')
  return decoding && Array.isArray(decoding.choices) ? decoding.choices : []
}

/** What the engine needs of a model in speech.cpp: its id, whether it can be told the language, and its decoding. */
type WorkerModel = Pick<Extract<AsrModel, { runtime: 'speech.cpp' }>, 'id' | 'languageHint' | 'decoding'>

/**
 * A speech recognition model behind speech.cpp's worker protocol 3. Each utterance is one request: its audio in
 * `chunk` messages of base64 16-bit PCM numbered from 0, at the rate it has, the samples a WAVE file sent to a server
 * holds, then `transcribe` with that rate and the language, answered with `progress` and one terminal message, `end`
 * with the text and its stop, `error` or `cancelled`. The language goes to every model: it steers Qwen3-ASR, which
 * writes it into its prompt as the llama-server engine begins the answer, and a model that cannot be told it only
 * checks it against its languages. The wait runs from writing the first chunk, once the lines are made, to reading
 * the `end`, as a server's runs from sending a request that holds the whole utterance. A model the catalog gives a
 * decoding has it set on every `transcribe`; the others decode as the model does by default.
 */
export class WorkerAsr implements AsrEngine {
  private readonly worker: WorkerProcess
  private readonly model: WorkerModel

  constructor(command: WorkerCommand, model: WorkerModel) {
    this.worker = new WorkerProcess(command)
    this.model = model
  }

  get log(): string | null {
    return this.worker.log
  }

  /**
   * Starts the worker on a model that takes the language and the decoding as the catalog says, so that a request
   * means what it says.
   */
  async start(): Promise<void> {
    const model = await this.worker.start()
    const steers = languageSteers(model)
    const told = this.model.languageHint === 'optional'
    if (steers !== told) {
      throw new Error(`the model file of ${this.model.id} says that its language ${steers ? 'steers it' : 'is only checked'}, and the catalog says that it ${told ? 'can' : 'cannot'} be told the language; correct languageHint in src/catalog/models.ts`)
    }
    const { decoding } = this.model
    const choices = decodingChoices(model)
    if (decoding !== null && !choices.includes(decoding)) {
      throw new Error(`${this.model.id} decodes ${decoding}, which this speech.cpp does not offer for its model file (${choices.length === 0 ? 'it offers no choice of decoding' : `it offers ${choices.join(', ')}`}); run a speech.cpp that does, such as a local build of its main branch named by SPEECH_BENCH_SPEECH_CPP`)
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
    const decoding = this.model.decoding === null ? {} : { decoding: this.model.decoding }
    lines.push(JSON.stringify({ type: 'transcribe', id, sample_rate: pcm.sampleRate, language: languageOf(locale), ...decoding }))
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
