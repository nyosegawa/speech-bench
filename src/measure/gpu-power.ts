import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
import type { MachineInfo } from '../core/platform.ts'
import type { GpuPowerRecord } from './result-file/format.ts'

/** The time between two readings of the GPUs' power, as nvidia-smi's `-lms` takes it. */
const INTERVAL_MS = 100

/** One reading of nvidia-smi's `--query-gpu=timestamp,index,power.draw --format=csv,noheader,nounits`. */
export interface PowerReading {
  timestamp: string
  index: number
  watts: number
}

/** A line nvidia-smi writes for one GPU, such as `2026/10/13 17:02:11.123, 0, 45.32`. */
export function parsePowerLine(line: string): PowerReading {
  const [timestamp, index, watts] = line.split(',').map((field) => field.trim())
  if (watts === '[N/A]') throw new Error(`nvidia-smi reads no power draw for GPU ${String(index)}, so its power cannot be measured`)
  if (!timestamp || !index || !watts || !/^\d+$/.test(index) || !Number.isFinite(Number(watts))) throw new Error(`nvidia-smi wrote a line that is not a time, a GPU and its power: ${line}`)
  return { timestamp, index: Number(index), watts: Number(watts) }
}

/**
 * The peak and the mean of the power of every NVIDIA GPU together, a reading's GPUs being those of one timestamp. It is
 * the power of the whole GPU, whatever runs on it.
 */
export function powerOf(readings: readonly PowerReading[]): GpuPowerRecord {
  const byTime = new Map<string, number>()
  for (const { timestamp, watts } of readings) byTime.set(timestamp, (byTime.get(timestamp) ?? 0) + watts)
  const totals = [...byTime.values()]
  if (totals.length === 0) throw new Error('nvidia-smi gave no reading of the GPUs\' power while the runtime ran')
  return { peakWatts: Math.max(...totals), meanWatts: totals.reduce((sum, watts) => sum + watts, 0) / totals.length, samples: totals.length }
}

/** Whether the machine has an NVIDIA GPU, whose power nvidia-smi reads; on others the power is not measured. */
export const hasNvidiaGpu = (machine: Pick<MachineInfo, 'platform' | 'gpus'>): boolean =>
  machine.platform !== 'darwin-arm64' && machine.gpus.some((gpu) => /\bNVIDIA\b/i.test(gpu.name))

/** nvidia-smi as the NVIDIA driver installs it: in System32 on Windows, which a shell's PATH may not reach, and on the PATH on Linux. */
const nvidiaSmi = (platform: MachineInfo['platform']): string =>
  platform === 'win32-x64' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe') : 'nvidia-smi'

/** Reads the power of the machine's NVIDIA GPUs through nvidia-smi while a runtime runs. */
export class GpuPowerSampler {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly readings: PowerReading[] = []
  private failure: Error | null = null
  private stopped = false

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child
  }

  /** Starts reading, once nvidia-smi has given its first reading; it fails when nvidia-smi is missing or cannot read. */
  static start(platform: MachineInfo['platform']): Promise<GpuPowerSampler> {
    const executable = nvidiaSmi(platform)
    const child = spawn(executable, ['--query-gpu=timestamp,index,power.draw', '--format=csv,noheader,nounits', `-lms`, String(INTERVAL_MS)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    return GpuPowerSampler.reading(child, executable)
  }

  /** Reads the lines of `child`, an nvidia-smi started from `executable` as start() starts it. */
  static reading(child: ChildProcessWithoutNullStreams, executable: string): Promise<GpuPowerSampler> {
    const sampler = new GpuPowerSampler(child)
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (text: string) => { stderr += text })
    return new Promise((resolve, reject) => {
      let started = false
      const fail = (error: Error): void => {
        if (!started) return reject(error)
        sampler.failure ??= error
      }
      child.once('error', (error) => fail(new Error(`nvidia-smi could not be started from ${executable} (${error.message}); the NVIDIA driver installs it`, { cause: error })))
      child.once('exit', (code) => {
        if (!sampler.stopped) fail(new Error(`nvidia-smi stopped reading the GPUs' power with code ${String(code)}: ${stderr.trim() || 'no message'}`))
      })
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        // nvidia-smi stopped in the middle of a line leaves a piece of it, such as its time alone, which readline gives
        // as a last line; what arrives once the sampler is stopping is not read.
        if (sampler.stopped || line.trim() === '') return
        try {
          sampler.readings.push(parsePowerLine(line))
          if (!started) {
            started = true
            resolve(sampler)
          }
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
          child.kill()
        }
      })
    })
  }

  /** Stops reading and gives the peak and mean power over the readings, or fails as the reading did. */
  async stop(): Promise<GpuPowerRecord> {
    await this.close()
    if (this.failure) throw this.failure
    return powerOf(this.readings)
  }

  /** Stops reading without a result, when a run has failed. */
  async close(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    if (this.child.exitCode !== null) return
    await new Promise((resolve) => {
      this.child.once('exit', resolve)
      this.child.kill()
    })
  }
}
