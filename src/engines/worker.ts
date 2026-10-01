import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { logsDir } from '../core/paths.ts'
import type { Synthesis, TtsEngine } from './tts-engine.ts'

const PROTOCOL_PREFIX = 'ASIST_JSON:'

/**
 * Loading the model and compiling GPU kernels comes before `ready`. After a GPU driver update the Vulkan
 * shaders took 12.6 s to compile on an RTX 2080 (2026-09-29), and an Irodori-TTS worker's first start
 * compiled Metal kernels for 16 s on an Apple M5 (2026-10-01).
 */
const READY_TIMEOUT_MS = 180_000

/** A protocol message of the worker, or null for a line of other output. */
export function parseWorkerLine(line: string): Record<string, unknown> | null {
  const marker = line.indexOf(PROTOCOL_PREFIX)
  if (marker < 0) return null
  return JSON.parse(line.slice(marker + PROTOCOL_PREFIX.length)) as Record<string, unknown>
}

/** A chunk's base64 16-bit little-endian mono samples as floats. */
export function decodeChunk(base64: string): Float32Array {
  const bytes = Buffer.from(base64, 'base64')
  const samples = new Float32Array(bytes.length / 2)
  for (let index = 0; index < samples.length; index++) samples[index] = bytes.readInt16LE(index * 2) / 32768
  return samples
}

interface Pending {
  started: number
  first: number | null
  chunks: Float32Array[]
  resolve: (synthesis: Synthesis) => void
  reject: (error: Error) => void
}

/** How to start a worker: its executable and arguments, and the voice a request names when the run has no built-in one. */
export interface WorkerCommand {
  name: string
  executable: string
  args: readonly string[]
  /** Variables set for the worker on top of the bench's own environment. */
  env?: Readonly<Record<string, string>>
  voice: string | null
}

/**
 * A synthesis model in a process that speaks speech.cpp's worker protocol over JSON lines, each line it writes
 * prefixed with `ASIST_JSON:`: a request per line on stdin (`id`, `text`, `voice`, `language` as a BCP 47 tag),
 * and on stdout `ready`, then `chunk` messages with base64 16-bit PCM and `end` for each request, `error` for
 * a request that failed and `fatal` for a worker that could not start. speech.cpp's `speech-worker` speaks it,
 * and so does any adapter written for a runtime that does not.
 */
export class WorkerTts implements TtsEngine {
  private child: ChildProcessWithoutNullStreams | null = null
  private sampleRate = 0
  private readonly pending = new Map<string, Pending>()
  private readonly command: WorkerCommand
  log: string | null = null

  constructor(command: WorkerCommand) {
    this.command = command
  }

  start(): Promise<void> {
    fs.mkdirSync(logsDir(), { recursive: true })
    const log = path.join(logsDir(), `${this.command.name}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
    this.log = log
    const child = spawn(this.command.executable, [...this.command.args], { env: { ...process.env, ...this.command.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    child.stderr.pipe(fs.createWriteStream(log))
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`the worker did not become ready in ${READY_TIMEOUT_MS / 1000} s; see ${log}`)), READY_TIMEOUT_MS)
      const fail = (error: Error): void => {
        clearTimeout(timeout)
        reject(error)
        for (const pending of this.pending.values()) pending.reject(error)
        this.pending.clear()
      }
      child.once('error', fail)
      child.once('exit', (code) => fail(new Error(`the worker exited with code ${String(code)}; see ${log}`)))
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        const message = parseWorkerLine(line)
        if (!message) return
        if (message.type === 'ready') {
          clearTimeout(timeout)
          if (typeof message.sampleRate !== 'number') return fail(new Error('the worker reported no sample rate'))
          this.sampleRate = message.sampleRate
          resolve()
        } else if (message.type === 'fatal') {
          fail(new Error(`the worker failed: ${String(message.error)}; see ${log}`))
        } else {
          this.receive(message)
        }
      })
    })
  }

  private receive(message: Record<string, unknown>): void {
    const pending = typeof message.id === 'string' ? this.pending.get(message.id) : undefined
    if (!pending) return
    if (message.type === 'chunk' && typeof message.pcm === 'string') {
      pending.first ??= performance.now()
      pending.chunks.push(decodeChunk(message.pcm))
      return
    }
    this.pending.delete(message.id as string)
    if (message.type !== 'end') return pending.reject(new Error(`the worker failed a sentence: ${String(message.error)}`))
    const finished = performance.now()
    const samples = new Float32Array(pending.chunks.reduce((sum, chunk) => sum + chunk.length, 0))
    let offset = 0
    for (const chunk of pending.chunks) {
      samples.set(chunk, offset)
      offset += chunk.length
    }
    pending.resolve({
      pcm: { sampleRate: this.sampleRate, samples },
      firstAudioSeconds: ((pending.first ?? finished) - pending.started) / 1000,
      totalSeconds: (finished - pending.started) / 1000
    })
  }

  synthesize(text: string, locale: string, voice: string | null): Promise<Synthesis> {
    const child = this.child
    if (!child) return Promise.reject(new Error('the worker is not started'))
    const named = voice ?? this.command.voice
    if (!named) return Promise.reject(new Error(`${this.command.name} needs a voice`))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { started: performance.now(), first: null, chunks: [], resolve, reject })
      child.stdin.write(`${JSON.stringify({ id, text, voice: named, language: locale })}\n`)
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
