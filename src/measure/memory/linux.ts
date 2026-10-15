import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { runTool, type Probe } from './probe.ts'
import type { ProcessRow, Snapshot } from './snapshot.ts'

/**
 * On Linux the resident memory of a process is its RSS, read with its parent from /proc/<pid>/stat, and its GPU memory
 * the memory nvidia-smi lists for it among the GPUs' compute processes, which holds a Vulkan runtime's buffers as it
 * holds CUDA's. In a container nvidia-smi gives the container's own pids (driver 580, RunPod, 2026-10-15: the worker of
 * pid 1429 was listed as 1429); a pid it lists that the machine does not have stops the run, since the memory of the
 * runtime could not be told from another process's.
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

/**
 * The GPU memory of each process in `nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader,nounits`,
 * in MiB, added up over the GPUs a process holds memory on. It writes nothing when no process holds any.
 */
export function parseComputeApps(text: string): Map<number, number> {
  const bytes = new Map<number, number>()
  for (const line of text.split('\n').filter((row) => row.trim() !== '')) {
    const [pid, mib] = line.split(',').map((field) => field.trim())
    if (!pid || !mib || !/^\d+$/.test(pid) || !/^\d+$/.test(mib)) throw new Error(`nvidia-smi wrote a compute process that is not a pid and its memory: ${line}`)
    bytes.set(Number(pid), (bytes.get(Number(pid)) ?? 0) + Number(mib) * 1024 * 1024)
  }
  return bytes
}

/** Fails when nvidia-smi lists a pid the machine does not have, which a look at /proc a moment before found. */
export function checkPids(gpuBytes: ReadonlyMap<number, number>, processes: readonly ProcessRow[], after: readonly ProcessRow[]): void {
  const known = new Set([...processes, ...after].map(({ pid }) => pid))
  for (const pid of gpuBytes.keys()) {
    if (!known.has(pid)) throw new Error(`nvidia-smi lists GPU memory for pid ${pid}, which is no process of this machine; it counts the pids of another namespace, so the runtime's GPU memory cannot be told`)
  }
}

/** Looks at /proc and asks nvidia-smi for the GPUs' compute processes, one after the other, which takes about 22 ms. */
export class LinuxProbe implements Probe {
  readonly gpu = 'dedicated' as const
  private readonly intervalMs: number
  private readonly pageBytes: number
  private readonly tool: typeof runTool
  private stopped = false
  private loop: Promise<void> | null = null
  private failure: Error | null = null

  constructor(intervalMs: number, tool: typeof runTool = runTool) {
    this.intervalMs = intervalMs
    this.tool = tool
    this.pageBytes = Number(execFileSync('getconf', ['PAGESIZE'], { encoding: 'utf8' }).trim())
    if (!Number.isInteger(this.pageBytes) || this.pageBytes <= 0) throw new Error('getconf gave no page size')
  }

  private async look(): Promise<Snapshot> {
    const processes = readProcesses(this.pageBytes)
    const listed = await this.tool('nvidia-smi', ['--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits'])
    if (listed.status !== 0) throw new Error(`nvidia-smi failed with status ${listed.status}: ${listed.stderr.trim() || listed.stdout.trim()}`)
    const gpuBytes = parseComputeApps(listed.stdout)
    // A process that started while nvidia-smi read is in the second look at /proc.
    checkPids(gpuBytes, processes, gpuBytes.size === 0 ? [] : readProcesses(this.pageBytes))
    return { processes, gpuBytes, residentAfterGpu: null }
  }

  async start(root: () => number | null, take: (snapshot: Snapshot, root: number | null) => void): Promise<void> {
    await this.look()
    this.loop = (async () => {
      try {
        while (!this.stopped) {
          const began = performance.now()
          const pid = root()
          take(await this.look(), pid)
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
    if (this.failure) throw this.failure
  }
}
