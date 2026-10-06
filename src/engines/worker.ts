import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { logsDir } from '../core/paths.ts'

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

/** The model information of a `ready` message, which must be of the protocol the bench speaks. */
function readyModel(ready: Record<string, unknown>): Record<string, unknown> {
  if (ready.protocol !== WORKER_PROTOCOL) throw new Error(`the worker speaks protocol ${JSON.stringify(ready.protocol)}, and the bench speaks protocol ${WORKER_PROTOCOL}`)
  const model = ready.model
  if (typeof model !== 'object' || model === null || Array.isArray(model)) throw new Error('the worker\'s ready gives no model information')
  return model as Record<string, unknown>
}

/**
 * The messages that answer a request and name it by its id. Protocol 2 may gain messages without being raised,
 * so a message of another type is passed over.
 */
const ANSWERS = new Set(['chunk', 'partial', 'progress', 'end', 'error', 'cancelled'])

/** How to start a worker: its executable and arguments. */
export interface WorkerCommand {
  name: string
  executable: string
  args: readonly string[]
  /** Variables set for the worker on top of the bench's own environment. */
  env?: Readonly<Record<string, string>>
}

/** The name a run's reference voice is given in a worker, which every request then names. */
export const REFERENCE_VOICE = 'reference'

/**
 * The arguments of speech.cpp's `speech worker` for a run: the model, the device and the reference voice. The worker
 * skips its own warm-up, so that the load time is the loading alone, as for every other runtime: the run's first
 * sentence or utterance, run once untimed, pays for the GPU's first use.
 */
export function speechWorkerArgs(model: string, device: string, voiceFile: string | null): string[] {
  return ['worker', model, '--device', device, '--no-warmup', ...(voiceFile === null ? [] : ['--add-voice', `${REFERENCE_VOICE}=${voiceFile}`])]
}

/**
 * What a request makes of the answers to it. Each method throws on an answer the request cannot have, which is
 * the worker's defect and fails every request.
 */
export interface Answers<T> {
  /** Takes a `chunk` or a `partial`, which come before the terminal message. */
  partway(message: Record<string, unknown>): void
  /** The request's result, from its `end`. */
  end(message: Record<string, unknown>): T
}

interface Pending {
  answers: Answers<unknown>
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

/**
 * A process that speaks speech.cpp's worker protocol 2 over JSON Lines, one JSON object per line and nothing else on
 * stdout: `ready` with the protocol and the model's information once it is loaded, or `fatal`; then for each request
 * the answers that name it by its id, `progress` among them, and one terminal message, `end`, `error` or `cancelled`.
 * speech.cpp's `speech worker` speaks it, and so does any adapter written for a runtime that does not. A line that
 * breaks the protocol fails every request in flight and every later one.
 */
export class WorkerProcess {
  private child: ChildProcessWithoutNullStreams | null = null
  private failure: Error | null = null
  private readonly pending = new Map<string, Pending>()
  private readonly command: WorkerCommand
  log: string | null = null

  constructor(command: WorkerCommand) {
    this.command = command
  }

  get name(): string {
    return this.command.name
  }

  /** Starts the worker and resolves with the model information of its `ready`. */
  start(): Promise<Record<string, unknown>> {
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
          const model = readyModel(message)
          ready = true
          clearTimeout(timeout)
          resolve(model)
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
    if (type === 'progress') return
    if (type === 'chunk' || type === 'partial') return pending.answers.partway(message)
    if (type === 'end') {
      // The request stays pending until its end is read, so that an end that breaks the protocol fails it with the rest.
      const result = pending.answers.end(message)
      this.pending.delete(id)
      pending.resolve(result)
      return
    }
    this.pending.delete(id)
    pending.reject(new Error(type === 'error' ? `the worker failed request ${id}: ${describeError(message.error)}` : `the worker cancelled request ${id}, which the bench did not cancel`))
  }

  /**
   * Writes a request's lines, the last of which makes it complete, and resolves with what `answers` makes of its
   * `end`. The lines come as JSON text, so that the caller can start its clock once they are made, as a server's
   * request is timed from the moment its body is ready.
   */
  request<T>(id: string, lines: readonly string[], answers: Answers<T>): Promise<T> {
    const child = this.child
    if (this.failure) return Promise.reject(this.failure)
    if (!child) return Promise.reject(new Error('the worker is not started'))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { answers, resolve: resolve as (result: unknown) => void, reject })
      for (const line of lines) child.stdin.write(`${line}\n`)
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
