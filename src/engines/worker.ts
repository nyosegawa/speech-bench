import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { logsDir } from '../core/paths.ts'
import type { Synthesis, TtsEngine } from './tts-engine.ts'

/**
 * Loading the model and compiling GPU kernels comes before `ready`. After a GPU driver update the Vulkan
 * shaders took 12.6 s to compile on an RTX 2080 (2026-09-29), and an Irodori-TTS worker's first start
 * compiled Metal kernels for 16 s on an Apple M5 (2026-10-01).
 */
const READY_TIMEOUT_MS = 180_000

/** The version of speech.cpp's worker protocol the bench speaks, which a worker raises when its callers must change. */
const WORKER_PROTOCOL = 2

/** A protocol message of the worker. Its stdout carries JSON objects alone, so any other line is the worker's defect. */
export function parseWorkerLine(line: string): Record<string, unknown> {
  let message: unknown
  try {
    message = JSON.parse(line)
  } catch {
    throw new Error(`the worker wrote a line on stdout that is not JSON: ${line.slice(0, 200)}`)
  }
  if (typeof message !== 'object' || message === null || Array.isArray(message)) throw new Error(`the worker wrote a line on stdout that is not a JSON object: ${line.slice(0, 200)}`)
  return message as Record<string, unknown>
}

/** A chunk's base64 16-bit little-endian mono samples as floats. */
export function decodeChunk(base64: string): Float32Array {
  const bytes = Buffer.from(base64, 'base64')
  const samples = new Float32Array(bytes.length / 2)
  for (let index = 0; index < samples.length; index++) samples[index] = bytes.readInt16LE(index * 2) / 32768
  return samples
}

/** The `error` member of `error` and `fatal`, written as speech.cpp's command line writes a failure. */
function describeError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return JSON.stringify(error)
  const { code, option, message } = error as Record<string, unknown>
  return `${String(code)}${typeof option === 'string' ? ` (${option})` : ''}: ${String(message)}`
}

/** The sample rate of a `ready` message, which must be of the protocol the bench speaks. */
function readyRate(ready: Record<string, unknown>): number {
  if (ready.protocol !== WORKER_PROTOCOL) throw new Error(`the worker speaks protocol ${JSON.stringify(ready.protocol)}, and the bench speaks protocol ${WORKER_PROTOCOL}`)
  const model = ready.model
  const rate = typeof model === 'object' && model !== null ? (model as Record<string, unknown>).sample_rate : undefined
  if (typeof rate !== 'number') throw new Error('the worker\'s ready gives no sample_rate in its model information')
  return rate
}

/**
 * The messages that answer a request and name it by its id. Protocol 2 may gain messages without being raised,
 * so a message of another type is passed over.
 */
const ANSWERS = new Set(['chunk', 'progress', 'end', 'error', 'cancelled'])

interface Pending {
  started: number
  first: number | null
  chunks: Float32Array[]
  seed: number | null
  resolve: (synthesis: Synthesis) => void
  reject: (error: Error) => void
}

/** How to start a worker: its executable and arguments. */
export interface WorkerCommand {
  name: string
  executable: string
  args: readonly string[]
  /** Variables set for the worker on top of the bench's own environment. */
  env?: Readonly<Record<string, string>>
}

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
 * A synthesis model in a process that speaks speech.cpp's worker protocol 2 over JSON Lines, one JSON object per line
 * and nothing else on stdout: `ready` with the protocol and the model's information once it is loaded, or `fatal`;
 * then for each `synthesize` request `chunk` messages of base64 16-bit PCM numbered from 0, `progress` while it passes
 * no audio, and one terminal message, `end`, `error` or `cancelled`. speech.cpp's `speech worker` speaks it, and so
 * does any adapter written for a runtime that does not. The first audio is the first chunk read after the request
 * is written.
 */
export class WorkerTts implements TtsEngine {
  private child: ChildProcessWithoutNullStreams | null = null
  private sampleRate = 0
  private nextSeed: number | null
  private failure: Error | null = null
  private readonly pending = new Map<string, Pending>()
  private readonly command: WorkerCommand
  private readonly requests: WorkerRequests
  log: string | null = null

  constructor(command: WorkerCommand, requests: WorkerRequests) {
    this.command = command
    this.requests = requests
    this.nextSeed = requests.seed
  }

  start(): Promise<void> {
    fs.mkdirSync(logsDir(), { recursive: true })
    const log = path.join(logsDir(), `${this.command.name}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
    this.log = log
    const child = spawn(this.command.executable, [...this.command.args], { env: { ...process.env, ...this.command.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    child.stderr.pipe(fs.createWriteStream(log))
    return new Promise((resolve, reject) => {
      let ready = false
      const fail = (error: Error): void => {
        clearTimeout(timeout)
        reject(error)
        if (this.failure) return
        this.failure = error
        for (const pending of this.pending.values()) pending.reject(error)
        this.pending.clear()
      }
      const timeout = setTimeout(() => fail(new Error(`the worker did not become ready in ${READY_TIMEOUT_MS / 1000} s; see ${log}`)), READY_TIMEOUT_MS)
      child.once('error', fail)
      child.once('exit', (code) => fail(new Error(`the worker exited with code ${String(code)}; see ${log}`)))
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        try {
          const message = parseWorkerLine(line)
          if (message.type === 'fatal') throw new Error(`the worker could not start: ${describeError(message.error)}`)
          if (message.type !== 'ready') return this.receive(message)
          if (ready) throw new Error('the worker reported ready a second time')
          this.sampleRate = readyRate(message)
          ready = true
          clearTimeout(timeout)
          resolve()
        } catch (error) {
          fail(new Error(`${(error as Error).message}; see ${log}`))
        }
      })
    })
  }

  /** Takes a message that answers a request, and throws on one that breaks the protocol. */
  private receive(message: Record<string, unknown>): void {
    const type = message.type
    if (typeof type !== 'string') throw new Error('the worker sent a message without a type')
    if (!ANSWERS.has(type)) return
    if (typeof message.id !== 'string') {
      throw new Error(type === 'error' ? `the worker refused a line it could not take as a request: ${describeError(message.error)}` : `the worker sent ${type} without the id of a request`)
    }
    const id = message.id
    const pending = this.pending.get(id)
    if (!pending) throw new Error(`the worker sent ${type} for request ${id}, which has had its answer or was never sent`)
    if (type === 'chunk') {
      if (message.seq !== pending.chunks.length || typeof message.pcm !== 'string') throw new Error(`the worker sent chunk ${String(message.seq)} of request ${id} where chunk ${pending.chunks.length} was due`)
      pending.first ??= performance.now()
      pending.chunks.push(decodeChunk(message.pcm))
      return
    }
    if (type === 'progress') return
    if (type === 'end') {
      const finished = performance.now()
      const samples = new Float32Array(pending.chunks.reduce((sum, chunk) => sum + chunk.length, 0))
      let offset = 0
      for (const chunk of pending.chunks) {
        samples.set(chunk, offset)
        offset += chunk.length
      }
      if (message.samples !== samples.length) throw new Error(`the worker ended request ${id} with ${String(message.samples)} samples, having sent ${samples.length}`)
      if (pending.seed !== null && message.seed !== pending.seed) throw new Error(`the worker sampled request ${id} with seed ${String(message.seed)}, not the ${pending.seed} it was sent`)
      this.pending.delete(id)
      pending.resolve({
        pcm: { sampleRate: this.sampleRate, samples },
        firstAudioSeconds: ((pending.first ?? finished) - pending.started) / 1000,
        totalSeconds: (finished - pending.started) / 1000
      })
      return
    }
    this.pending.delete(id)
    pending.reject(new Error(type === 'error' ? `the worker failed a sentence: ${describeError(message.error)}` : 'the worker cancelled a sentence the bench did not cancel'))
  }

  synthesize(text: string, locale: string, voice: string | null): Promise<Synthesis> {
    const child = this.child
    if (this.failure) return Promise.reject(this.failure)
    if (!child) return Promise.reject(new Error('the worker is not started'))
    const named = voice ?? this.requests.voice
    if (!named) return Promise.reject(new Error(`${this.command.name} needs a voice`))
    const id = randomUUID()
    const seed = this.nextSeed
    if (this.nextSeed !== null) this.nextSeed += 1
    const request = { type: 'synthesize', id, text, voice: named, language: locale, ...(seed === null ? {} : { seed }), ...this.requests.options }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { started: performance.now(), first: null, chunks: [], seed, resolve, reject })
      child.stdin.write(`${JSON.stringify(request)}\n`)
    })
  }

  stop(): Promise<void> {
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null) return Promise.resolve()
    return new Promise((resolve) => {
      child.removeAllListeners('exit')
      child.once('exit', () => resolve())
      child.kill('SIGTERM')
    })
  }
}
