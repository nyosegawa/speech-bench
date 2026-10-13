import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runTool, type Probe } from './probe.ts'
import { processTree, type ProcessRow, type Snapshot } from './snapshot.ts'

/**
 * On macOS the resident memory of a process is its RSS as `ps` gives it, and its GPU memory is the part of its physical
 * footprint that `footprint` puts in a category tagged `(graphics)`: the buffers Metal's driver allocated for it, once
 * the GPU or the CPU has written them. RSS does not count those buffers, and the footprint does not count a model
 * file mapped into memory, which llama.cpp reads its weights through, so neither alone gives what a runtime holds.
 */

/** The processes of `ps -A -o pid=,ppid=,rss=`, whose RSS is in KiB. */
export function parsePs(text: string): ProcessRow[] {
  return text.split('\n').filter((line) => line.trim() !== '').map((line) => {
    const fields = line.trim().split(/\s+/).map(Number)
    if (fields.length !== 3 || fields.some((field) => !Number.isInteger(field))) throw new Error(`ps wrote a line that is not a pid, a parent and an RSS: ${line}`)
    const [pid, parent, kib] = fields as [number, number, number]
    return { pid, parent, residentBytes: kib * 1024 }
  })
}

/** footprint's own name for a category of memory that Metal's driver allocated, such as `IOAccelerator (graphics)`. */
const GRAPHICS = / \(graphics\)$/

/**
 * The GPU memory of each process in the JSON `footprint -f bytes -j` writes: the dirty and the compressed bytes of every
 * category tagged `(graphics)`, which is how footprint counts a category into a process's footprint.
 */
export function graphicsBytes(json: unknown): Map<number, number> {
  const processes = (json as { processes?: unknown }).processes
  if (!Array.isArray(processes)) throw new Error('footprint wrote JSON without its processes')
  const bytes = new Map<number, number>()
  for (const process of processes as Array<{ pid?: unknown; categories?: unknown }>) {
    if (typeof process.pid !== 'number' || typeof process.categories !== 'object' || process.categories === null) {
      throw new Error('footprint wrote a process without its pid or its categories')
    }
    let graphics = 0
    for (const [name, category] of Object.entries(process.categories as Record<string, { dirty?: unknown; swapped?: unknown }>)) {
      if (!GRAPHICS.test(name)) continue
      if (typeof category.dirty !== 'number' || typeof category.swapped !== 'number') throw new Error(`footprint wrote the category ${name} without its dirty and swapped bytes`)
      graphics += category.dirty + category.swapped
    }
    bytes.set(process.pid, graphics)
  }
  return bytes
}

/** What footprint writes when every process it was asked about has exited. */
const NONE_FOUND = /Unable to find any processes matching/

/** Looks with `ps` at every process and with `footprint` at the processes of the tree, one after the other. */
export class MacProbe implements Probe {
  readonly gpu = 'metal' as const
  private readonly intervalMs: number
  private readonly folder = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-footprint-'))
  private stopped = false
  private loop: Promise<void> | null = null
  private failure: Error | null = null

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs
  }

  private async look(root: number | null): Promise<Snapshot> {
    const listed = await runTool('ps', ['-A', '-o', 'pid=,ppid=,rss='])
    if (listed.status !== 0) throw new Error(`ps failed with status ${listed.status}: ${listed.stderr.trim()}`)
    const processes = parsePs(listed.stdout)
    const tree = root === null ? new Set<number>() : processTree(processes, root)
    if (tree.size === 0) return { processes, gpuBytes: new Map() }
    const file = path.join(this.folder, 'footprint.json')
    const measured = await runTool('footprint', ['-f', 'bytes', '-j', file, ...[...tree].flatMap((pid) => ['-p', String(pid)])])
    if (measured.status !== 0) {
      if (NONE_FOUND.test(measured.stderr)) return { processes, gpuBytes: new Map() }
      throw new Error(`footprint failed with status ${measured.status}: ${measured.stderr.trim()}`)
    }
    return { processes, gpuBytes: graphicsBytes(JSON.parse(fs.readFileSync(file, 'utf8'))) }
  }

  async start(root: () => number | null, take: (snapshot: Snapshot, root: number | null) => void): Promise<void> {
    // The bench's own process stands in for the runtime's, which has not started yet, to check both tools answer.
    await this.look(process.pid)
    this.loop = (async () => {
      try {
        while (!this.stopped) {
          const began = performance.now()
          const pid = root()
          const snapshot = await this.look(pid)
          take(snapshot, pid)
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, this.intervalMs - (performance.now() - began))))
        }
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error))
      }
    })()
  }

  async stop(): Promise<void> {
    this.stopped = true
    await this.loop
    fs.rmSync(this.folder, { recursive: true, force: true })
    if (this.failure) throw this.failure
  }
}
