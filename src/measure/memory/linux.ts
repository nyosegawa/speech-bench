import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import readline from 'node:readline'
import type { Probe } from './probe.ts'
import type { ProcessRow, Snapshot } from './snapshot.ts'

/**
 * On Linux the resident memory of a process is its RSS, read with its parent from /proc/<pid>/stat, and the GPU memory
 * is the memory in use on the machine's NVIDIA GPUs beyond what they held before the runtime started, read with
 * nvidia-smi. nvidia-smi gives memory per process only by the pids of the machine, which a container's processes do
 * not have, so in a rented container it lists none; the whole GPU is the runtime's on a machine nothing else uses.
 */

/**
 * The parent and the resident pages of a process from the text of /proc/<pid>/stat, whose second field, the command
 * in parentheses, may itself hold spaces and parentheses; the parent is the fourth field and the RSS the 24th.
 */
export function parseStat(text: string): { parent: number; residentPages: number } {
  const close = text.lastIndexOf(')')
  const fields = text.slice(close + 2).trim().split(' ')
  const parent = Number(fields[1])
  const residentPages = Number(fields[21])
  if (close < 0 || !Number.isInteger(parent) || !Number.isInteger(residentPages)) throw new Error(`/proc gave a stat without a parent and an RSS: ${text.slice(0, 200)}`)
  return { parent, residentPages }
}

/** Every process /proc lists, with its parent and RSS; a process that exits while it is read is left out. */
function readProcesses(pageBytes: number): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    let text: string
    try {
      text = fs.readFileSync(`/proc/${name}/stat`, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ESRCH') continue
      throw error
    }
    const { parent, residentPages } = parseStat(text)
    rows.push({ pid: Number(name), parent, residentBytes: residentPages * pageBytes })
  }
  return rows
}

/** One line of `nvidia-smi --query-gpu=timestamp,index,memory.used --format=csv,noheader,nounits`, its MiB in bytes. */
export function parseMemoryLine(line: string): { timestamp: string; index: number; bytes: number } {
  const [timestamp, index, mib] = line.split(',').map((field) => field.trim())
  if (!timestamp || !index || !mib || !/^\d+$/.test(index) || !/^\d+$/.test(mib)) throw new Error(`nvidia-smi wrote a line that is not a time, a GPU and its memory in use: ${line}`)
  return { timestamp, index: Number(index), bytes: Number(mib) * 1024 * 1024 }
}

/**
 * The memory in use on all GPUs together from nvidia-smi's lines, a reading being the GPUs of one timestamp; it keeps
 * the latest whole reading and the first, which the runtime's memory is counted beyond.
 */
export class DeviceMemory {
  private readonly gpus: number
  private pending: { timestamp: string; bytes: number; count: number } | null = null
  first: number | null = null
  latest: number | null = null

  constructor(gpus: number) {
    this.gpus = gpus
  }

  add(line: string): void {
    const { timestamp, bytes } = parseMemoryLine(line)
    if (this.pending === null || this.pending.timestamp !== timestamp) this.pending = { timestamp, bytes: 0, count: 0 }
    this.pending.bytes += bytes
    this.pending.count++
    if (this.pending.count === this.gpus) {
      this.latest = this.pending.bytes
      this.first ??= this.pending.bytes
    }
  }

  /** The memory in use beyond the first reading, never below zero. */
  beyondFirst(): number {
    if (this.first === null || this.latest === null) throw new Error('nvidia-smi has given no whole reading of the GPUs\' memory')
    return Math.max(0, this.latest - this.first)
  }
}

/** The time between two readings of the GPUs' memory, as nvidia-smi's `-lms` takes it. */
const NVIDIA_SMI_MS = 100

/** Looks at /proc every `intervalMs` while nvidia-smi reads the GPUs' memory every 100 ms. */
export class LinuxProbe implements Probe {
  readonly gpu = 'device' as const
  private readonly intervalMs: number
  private readonly pageBytes: number
  private readonly gpus: number
  private child: ChildProcessWithoutNullStreams | null = null
  private stopped = false
  private loop: Promise<void> | null = null
  private failure: Error | null = null

  constructor(intervalMs: number, gpus: number) {
    this.intervalMs = intervalMs
    this.gpus = gpus
    this.pageBytes = Number(execFileSync('getconf', ['PAGESIZE'], { encoding: 'utf8' }).trim())
    if (!Number.isInteger(this.pageBytes) || this.pageBytes <= 0) throw new Error('getconf gave no page size')
  }

  async start(root: () => number | null, take: (snapshot: Snapshot, root: number | null) => void): Promise<void> {
    const memory = new DeviceMemory(this.gpus)
    const child = spawn('nvidia-smi', ['--query-gpu=timestamp,index,memory.used', '--format=csv,noheader,nounits', '-lms', String(NVIDIA_SMI_MS)], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (text: string) => { stderr += text })
    await new Promise<void>((resolve, reject) => {
      let started = false
      const fail = (error: Error): void => {
        if (!started) return reject(error)
        this.failure ??= error
      }
      child.once('error', (error) => fail(new Error(`nvidia-smi could not be started to read the GPUs' memory (${error.message}); the NVIDIA driver installs it`, { cause: error })))
      child.once('exit', (code) => {
        if (!this.stopped) fail(new Error(`nvidia-smi stopped reading the GPUs' memory with code ${String(code)}: ${stderr.trim() || 'no message'}`))
      })
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        if (this.stopped || line.trim() === '') return
        try {
          memory.add(line)
          if (!started && memory.first !== null) {
            started = true
            resolve()
          }
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
          child.kill()
        }
      })
    })
    readProcesses(this.pageBytes)
    this.loop = (async () => {
      try {
        while (!this.stopped && this.failure === null) {
          const began = performance.now()
          const pid = root()
          const processes = readProcesses(this.pageBytes)
          take({ processes, gpuBytes: new Map(pid === null ? [] : [[pid, memory.beyondFirst()]]), residentAfterGpu: null }, pid)
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, this.intervalMs - (performance.now() - began))))
        }
      } catch (error) {
        this.failure ??= error instanceof Error ? error : new Error(String(error))
      }
    })()
  }

  async stop(): Promise<void> {
    this.stopped = true
    await this.loop
    const child = this.child
    if (child && child.exitCode === null) {
      await new Promise((resolve) => {
        child.once('exit', resolve)
        child.kill()
      })
    }
    if (this.failure) throw this.failure
  }
}
