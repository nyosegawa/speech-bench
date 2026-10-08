import { randomUUID } from 'node:crypto'
import type { Synthesis, TtsEngine } from './tts-engine.ts'
import { decodeChunk, WorkerProcess, type WorkerCommand } from './worker.ts'

/** What every request of a run is sent with. */
export interface WorkerRequests {
  /** The voice a request names when the run has no built-in one. */
  voice: string | null
  /**
   * The seed of the first request, each later request taking the next: the rule the runs of speech.cpp and of the
   * adapters are recorded under. Null leaves each request to draw its own.
   */
  seed: number | null
  /** Request options every request carries as members, such as the sampler's `steps`. */
  options: Readonly<Record<string, string | number | boolean>>
}

/**
 * A synthesis model behind speech.cpp's worker protocol 3. Each sentence is a `synthesize` request, answered with
 * `chunk` messages of base64 16-bit PCM numbered from 0, `progress` while it passes no audio, and one terminal
 * message, `end` with the seed and the number of samples sent, `error` or `cancelled`. The first audio is the first
 * chunk read after the request is written.
 */
export class WorkerTts implements TtsEngine {
  private readonly worker: WorkerProcess
  private sampleRate = 0
  private nextSeed: number | null
  private readonly requests: WorkerRequests

  constructor(command: WorkerCommand, requests: WorkerRequests) {
    this.worker = new WorkerProcess(command)
    this.requests = requests
    this.nextSeed = requests.seed
  }

  get log(): string | null {
    return this.worker.log
  }

  async start(): Promise<void> {
    const rate = (await this.worker.start()).sample_rate
    if (typeof rate !== 'number') throw new Error(`the worker's ready gives no sample_rate in its model information; see ${this.worker.log}`)
    this.sampleRate = rate
  }

  synthesize(text: string, locale: string, voice: string | null): Promise<Synthesis> {
    const named = voice ?? this.requests.voice
    if (!named) return Promise.reject(new Error(`${this.worker.name} needs a voice`))
    const id = randomUUID()
    const seed = this.nextSeed
    if (this.nextSeed !== null) this.nextSeed += 1
    const line = JSON.stringify({ type: 'synthesize', id, text, voice: named, language: locale, ...(seed === null ? {} : { seed }), ...this.requests.options })
    const chunks: Float32Array[] = []
    let first: number | null = null
    const started = performance.now()
    return this.worker.request(id, [line], {
      partway: (message) => {
        if (message.type !== 'chunk') throw new Error(`the worker sent ${String(message.type)} for synthesis request ${id}, which a synthesis is not answered with`)
        if (message.seq !== chunks.length || typeof message.pcm !== 'string') throw new Error(`the worker sent chunk ${String(message.seq)} of request ${id} where chunk ${chunks.length} was due`)
        first ??= performance.now()
        chunks.push(decodeChunk(message.pcm))
      },
      end: (message) => {
        const finished = performance.now()
        const samples = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
        let offset = 0
        for (const chunk of chunks) {
          samples.set(chunk, offset)
          offset += chunk.length
        }
        if (message.samples !== samples.length) throw new Error(`the worker ended request ${id} with ${String(message.samples)} samples, having sent ${samples.length}`)
        if (seed !== null && message.seed !== seed) throw new Error(`the worker sampled request ${id} with seed ${String(message.seed)}, not the ${seed} it was sent`)
        return {
          pcm: { sampleRate: this.sampleRate, samples },
          firstAudioSeconds: ((first ?? finished) - started) / 1000,
          totalSeconds: (finished - started) / 1000
        }
      }
    })
  }

  stop(): Promise<void> {
    return this.worker.stop()
  }
}
