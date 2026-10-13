import { machineLoad, type MachineInfo, type MachineLoad } from '../core/platform.ts'
import { GpuPowerSampler, hasNvidiaGpu } from './gpu-power.ts'
import { MemorySampler } from './memory/sampler.ts'
import type { RunRecord } from './result-file/format.ts'

/** What is read of the machine while a runtime runs, which a run line records. */
export type Watched = Pick<RunRecord, 'memory' | 'gpuPower' | 'load'>

/**
 * Watches a runtime from before it starts until it stops: how busy the machine was before and after, the memory of
 * the runtime's processes, and the power of an NVIDIA GPU. Each sampler starts before the runtime, so that one whose
 * tool is missing stops the run before it measures.
 */
export class RuntimeWatch {
  private readonly before: MachineLoad
  private readonly memory: MemorySampler
  private readonly power: GpuPowerSampler | null

  private constructor(before: MachineLoad, memory: MemorySampler, power: GpuPowerSampler | null) {
    this.before = before
    this.memory = memory
    this.power = power
  }

  static async start(machine: MachineInfo, root: () => number | null): Promise<RuntimeWatch> {
    const before = await machineLoad()
    const memory = await MemorySampler.start(root)
    try {
      return new RuntimeWatch(before, memory, hasNvidiaGpu(machine) ? await GpuPowerSampler.start() : null)
    } catch (error) {
      await memory.close()
      throw error
    }
  }

  /** Stops the samplers. Call `after` once the runtime has stopped, for the machine's load after it. */
  async stop(): Promise<Omit<Watched, 'load'>> {
    const memory = await this.memory.stop()
    return { memory, gpuPower: this.power === null ? null : await this.power.stop() }
  }

  /** How busy the machine was before the runtime started and after it stopped. */
  async after(): Promise<Watched['load']> {
    return { before: this.before, after: await machineLoad() }
  }

  /** Stops the samplers when a run has failed and what they read is not recorded. */
  async close(): Promise<void> {
    await this.memory.close()
    await this.power?.close()
  }
}
