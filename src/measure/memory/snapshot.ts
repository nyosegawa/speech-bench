import type { MemoryRecord } from '../result-file/format.ts'

/** A process as one look at the machine found it. */
export interface ProcessRow {
  pid: number
  parent: number
  residentBytes: number
}

/** What one look at the machine found: its processes, and the GPU memory of the processes it was read for. */
export interface Snapshot {
  processes: readonly ProcessRow[]
  gpuBytes: ReadonlyMap<number, number>
  /**
   * The resident memory of each process read again after its GPU memory, on a Mac, where `ps` and `footprint` read one
   * after the other; null where one read takes both at one moment. A process missing from it had exited.
   */
  residentAfterGpu: ReadonlyMap<number, number> | null
}

export type GpuMeasure = NonNullable<MemoryRecord['gpu']>['measure']

/** The process `root` and every process under it that the snapshot lists, which is none once `root` has exited. */
export function processTree(processes: readonly ProcessRow[], root: number): Set<number> {
  const children = new Map<number, number[]>()
  for (const { pid, parent } of processes) {
    // On Windows the idle process is its own parent, and a pid can name the parent of a process that outlived it.
    if (pid !== parent) children.set(parent, [...(children.get(parent) ?? []), pid])
  }
  if (!processes.some(({ pid }) => pid === root)) return new Set()
  const tree = new Set([root])
  const open = [root]
  for (let pid = open.pop(); pid !== undefined; pid = open.pop()) {
    for (const child of children.get(pid) ?? []) {
      if (tree.has(child)) continue
      tree.add(child)
      open.push(child)
    }
  }
  return tree
}

/**
 * The peaks of a process tree's memory over the snapshots it is given, each the largest sum over the processes of one
 * snapshot, so that two processes that peak at different times are not added at their peaks. On a Mac it also keeps the
 * peak of the resident and the Metal memory summed in one snapshot, since a runtime's weights count in one or the other
 * by how it allocates them, and the two may peak at different times.
 */
export class PeakMemory {
  private samples = 0
  private peakResident = 0
  private peakGpu = 0
  private peakTotal = 0
  private machineGpu = false
  private readonly intervalMs: number
  private readonly gpu: GpuMeasure

  constructor(intervalMs: number, gpu: GpuMeasure) {
    this.intervalMs = intervalMs
    this.gpu = gpu
  }

  /** Takes a snapshot of the tree under `root`; a snapshot before the process starts or after it exits adds nothing. */
  add(snapshot: Snapshot, root: number | null): void {
    for (const bytes of snapshot.gpuBytes.values()) if (bytes > 0) this.machineGpu = true
    if (root === null) return
    const tree = processTree(snapshot.processes, root)
    if (tree.size === 0) return
    this.samples++
    let resident = 0
    for (const process of snapshot.processes) if (tree.has(process.pid)) resident += process.residentBytes
    let gpu = 0
    for (const pid of tree) gpu += snapshot.gpuBytes.get(pid) ?? 0
    // The resident peak is the first reading's alone, which `ps` takes of every process at one moment.
    this.peakResident = Math.max(this.peakResident, resident)
    this.peakGpu = Math.max(this.peakGpu, gpu)
    this.peakTotal = Math.max(this.peakTotal, this.residentBesideGpu(snapshot, tree) + gpu)
  }

  /**
   * The resident memory of the tree to add to its GPU memory. Where the two are read one after the other, memory that
   * moves between a process's own memory and Metal's while footprint reads counts in the GPU memory and in one of the two
   * readings of RSS around it, which one depending on the direction; the smaller of the two counts it at most once. A
   * look may then miss memory that moved, which the next look counts, where a double count is a peak no moment had.
   */
  private residentBesideGpu(snapshot: Snapshot, tree: ReadonlySet<number>): number {
    let resident = 0
    for (const process of snapshot.processes) {
      if (!tree.has(process.pid)) continue
      const after = snapshot.residentAfterGpu === null ? process.residentBytes : snapshot.residentAfterGpu.get(process.pid) ?? 0
      resident += Math.min(process.residentBytes, after)
    }
    return resident
  }

  /**
   * The peaks as a result records them. A machine on which no process held dedicated GPU memory in any snapshot has
   * no GPU memory of its own, and records none rather than a zero; every Apple silicon Mac has Metal.
   */
  record(): MemoryRecord {
    if (this.samples === 0) throw new Error('the memory of the runtime\'s processes was never sampled; the runtime may have exited at once')
    const gpu: MemoryRecord['gpu'] = this.gpu === 'metal'
      ? { measure: 'metal', peakBytes: this.peakGpu, peakTotalBytes: this.peakTotal }
      : this.machineGpu ? { measure: 'dedicated', peakBytes: this.peakGpu } : null
    return { intervalMs: this.intervalMs, samples: this.samples, peakResidentBytes: this.peakResident, gpu }
  }
}
