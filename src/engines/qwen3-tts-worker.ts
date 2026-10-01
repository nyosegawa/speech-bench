import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import type { TtsModel } from '../catalog.ts'
import { languageOf } from '../language.ts'
import { logsDir } from '../paths.ts'
import type { Synthesis, TtsEngine } from './tts-engine.ts'

const PROTOCOL_PREFIX = 'ASIST_JSON:'

/**
 * Loading the model and compiling GPU kernels comes before `ready`. After a GPU driver update the Vulkan
 * shaders took 12.6 s to compile on an RTX 2080 (2026-09-29).
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

type Model = Extract<TtsModel, { runtime: 'qwen3-tts-worker' }>

interface Pending {
  started: number
  first: number | null
  chunks: Float32Array[]
  resolve: (synthesis: Synthesis) => void
  reject: (error: Error) => void
}

/**
 * Qwen3-TTS in qwen3-tts-ggml's worker, spoken to over JSON lines: a request per line on stdin, and on
 * stdout `ready`, then `chunk` messages with audio while the sentence is generated and `end` when it is done.
 */
export class Qwen3TtsWorker implements TtsEngine {
  private child: ChildProcessWithoutNullStreams | null = null
  private sampleRate = 0
  private readonly pending = new Map<string, Pending>()
  private readonly executable: string
  private readonly model: Model
  private readonly files: readonly string[]
  private readonly device: string
  log: string | null = null

  constructor(executable: string, model: Model, files: readonly string[], device: string) {
    this.executable = executable
    this.model = model
    this.files = files
    this.device = device
  }

  start(): Promise<void> {
    const [talker, codec] = this.files
    if (!talker || !codec) return Promise.reject(new Error(`${this.model.id} needs a talker and a codec`))
    fs.mkdirSync(logsDir(), { recursive: true })
    const log = path.join(logsDir(), `${this.model.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
    this.log = log
    const child = spawn(this.executable, [talker, codec, '--device', this.device], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
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
    const language = this.model.languageNames[languageOf(locale)]
    if (!language) return Promise.reject(new Error(`${this.model.id} cannot speak ${locale}`))
    if (!voice) return Promise.reject(new Error(`${this.model.id} needs a voice`))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { started: performance.now(), first: null, chunks: [], resolve, reject })
      child.stdin.write(`${JSON.stringify({ id, text, voice, language, speed: 1 })}\n`)
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
