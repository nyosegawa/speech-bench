import type { MachineInfo } from '../../core/platform.ts'
import type { MemoryRecord } from '../result-file/format.ts'
import { LinuxProbe } from './linux.ts'
import { MacProbe } from './macos.ts'
import type { Probe } from './probe.ts'
import { PeakMemory } from './snapshot.ts'
import { WindowsProbe } from './windows.ts'

/**
 * The time between two looks at the runtime's memory. A look on macOS takes longer for an adapter, about 210 ms for uv
 * and Python on an Apple M5 (2026-10-13), to which reading `ps` a second time adds about 10 ms (2026-10-14), and the
 * next look waits for the one before it.
 */
const INTERVAL_MS = 100

/**
 * Samples the memory of a runtime's processes from before it starts until it is stopped: the process `root` names
 * once the engine has started it, and every process under it.
 */
export class MemorySampler {
  private readonly probe: Probe
  private readonly peak: PeakMemory

  private constructor(probe: Probe) {
    this.probe = probe
    this.peak = new PeakMemory(INTERVAL_MS, probe.gpu)
  }

  /** Starts sampling on `machine`, once the tools it reads have answered. */
  static async start(root: () => number | null, machine: Pick<MachineInfo, 'platform' | 'gpus'>): Promise<MemorySampler> {
    const probe = machine.platform === 'darwin-arm64'
      ? new MacProbe(INTERVAL_MS)
      : machine.platform === 'win32-x64' ? new WindowsProbe(INTERVAL_MS) : new LinuxProbe(INTERVAL_MS, machine.gpus.length)
    const sampler = new MemorySampler(probe)
    await probe.start(root, (snapshot, pid) => sampler.peak.add(snapshot, pid))
    return sampler
  }

  /** Stops sampling and gives the peaks, or fails as the sampling did. */
  async stop(): Promise<MemoryRecord> {
    await this.probe.stop()
    return this.peak.record()
  }

  /** Stops sampling when a run has failed and its memory is not recorded. */
  async close(): Promise<void> {
    await this.probe.stop().catch(() => undefined)
  }
}
