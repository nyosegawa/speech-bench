import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'

/**
 * The systems the bench runs on: macOS on Apple silicon, Windows on x64, and Linux on x64 with an NVIDIA GPU, as a
 * machine rented in the cloud is.
 */
export type PlatformKey = 'darwin-arm64' | 'win32-x64' | 'linux-x64'

export function platformKey(): PlatformKey {
  const key = `${process.platform}-${process.arch}`
  if (key === 'darwin-arm64' || key === 'win32-x64' || key === 'linux-x64') return key
  throw new Error(`speech-bench runs on macOS arm64, Windows x64 and Linux x64, not ${key}`)
}

/** The GPU interface ggml runs on here: Metal on a Mac, Vulkan on Windows and Linux. */
export const gpuBackend = (): 'metal' | 'vulkan' => (platformKey() === 'darwin-arm64' ? 'metal' : 'vulkan')

/**
 * The GPU PyTorch runs the official implementations on here: Metal through MPS on a Mac, CUDA on Windows and Linux,
 * where the adapters install PyTorch's CUDA build. The adapters refuse to start on a machine without it rather than run
 * on the CPU.
 */
export const torchDevice = (): 'mps' | 'cuda' => (platformKey() === 'darwin-arm64' ? 'mps' : 'cuda')

/**
 * The GPU the runtimes are told to use, in ggml's device names; SPEECH_BENCH_DEVICE picks another, for
 * example Vulkan1 on a Windows machine with two GPUs.
 */
export const gpuDevice = (): string => process.env.SPEECH_BENCH_DEVICE?.trim() || (gpuBackend() === 'metal' ? 'MTL0' : 'Vulkan0')

/** A GPU of the machine and the version of its driver, null on a Mac, where the driver is part of macOS. */
export interface Gpu {
  name: string
  driver: string | null
}

/** Where a Mac draws its power from, and whether Low Power Mode slows it. */
export interface Power {
  source: 'ac' | 'battery'
  lowPowerMode: boolean
}

/** What a result was measured on, stored with every run so that runs from several machines can be compared. */
export interface MachineInfo {
  platform: PlatformKey
  hostname: string
  /** The system and its version, with the build on a Mac, whose Metal driver comes with it. */
  os: string
  cpu: string
  memoryGb: number
  gpus: Gpu[]
  /** A Mac's power, which can slow it; null on Windows and Linux, which the bench runs on desktops and servers. */
  power: Power | null
}

/**
 * Windows 11 reports itself as version 10.0 like Windows 10; its builds start at 22000, so the build number
 * is what tells them apart.
 */
export function windowsName(release: string): string {
  const build = Number(release.split('.')[2])
  return `Windows ${build >= 22_000 ? '11' : '10'} (build ${build})`
}

/** The GPUs as PowerShell writes the name and driver version of each video controller, a tab between them. */
export function parseVideoControllers(text: string): Gpu[] {
  return text.split(/\r?\n/).filter((line) => line.trim() !== '').map((line) => {
    const [name, driver] = line.split('\t').map((field) => field.trim())
    if (!name || !driver) throw new Error(`PowerShell gave a video controller without a name and a driver version: ${line}`)
    return { name, driver }
  })
}

/** The GPUs as `nvidia-smi --query-gpu=name,driver_version --format=csv,noheader` writes them, one a line. */
export function parseNvidiaGpus(text: string): Gpu[] {
  const gpus = text.split(/\r?\n/).filter((line) => line.trim() !== '').map((line) => {
    const comma = line.lastIndexOf(',')
    const [name, driver] = [line.slice(0, comma).trim(), line.slice(comma + 1).trim()]
    if (comma < 0 || !name || !driver) throw new Error(`nvidia-smi gave a GPU without a name and a driver version: ${line}`)
    return { name, driver }
  })
  if (gpus.length === 0) throw new Error('nvidia-smi lists no GPU; speech-bench runs on Linux with an NVIDIA GPU')
  return gpus
}

/**
 * A Linux system's name from /etc/os-release, its PRETTY_NAME, with the kernel's release, since a container reports the
 * system of its image and the kernel of the machine it runs on.
 */
export function linuxName(osRelease: string, kernel: string): string {
  const pretty = /^PRETTY_NAME=(?:"([^"]*)"|(\S+))$/m.exec(osRelease)
  const name = pretty?.[1] ?? pretty?.[2]
  if (!name) throw new Error('/etc/os-release names no PRETTY_NAME')
  return `${name} (Linux ${kernel})`
}

/** A Mac's power from `pmset -g batt`, which names the source, and `pmset -g`, which lists `lowpowermode`. */
export function parsePower(battery: string, settings: string): Power {
  const source = /Now drawing from '(AC Power|Battery Power)'/.exec(battery)?.[1]
  const lowPowerMode = /^\s*lowpowermode\s+([01])\s*$/m.exec(settings)?.[1]
  if (source === undefined || lowPowerMode === undefined) throw new Error(`pmset gave no power source or Low Power Mode: ${battery.split('\n')[0]}`)
  return { source: source === 'AC Power' ? 'ac' : 'battery', lowPowerMode: lowPowerMode === '1' }
}

const read = (command: string, args: string[]): string =>
  execFileSync(command, args, { encoding: 'utf8', windowsHide: true }).trim()

export function machineInfo(): MachineInfo {
  const platform = platformKey()
  const memoryGb = Math.round(os.totalmem() / 1024 ** 3)
  if (platform === 'darwin-arm64') {
    const cpu = read('sysctl', ['-n', 'machdep.cpu.brand_string'])
    const system = `macOS ${read('sw_vers', ['-productVersion'])} (${read('sw_vers', ['-buildVersion'])})`
    // On a Mac the GPU is part of the chip that names the CPU.
    return { platform, hostname: os.hostname(), os: system, cpu, memoryGb, gpus: [{ name: cpu, driver: null }], power: parsePower(read('pmset', ['-g', 'batt']), read('pmset', ['-g'])) }
  }
  const cpu = os.cpus()[0]?.model.trim() ?? 'unknown'
  if (platform === 'linux-x64') {
    let listed: string
    try {
      listed = read('nvidia-smi', ['--query-gpu=name,driver_version', '--format=csv,noheader'])
    } catch (error) {
      throw new Error(`nvidia-smi could not list the GPUs (${(error as Error).message}); speech-bench runs on Linux with an NVIDIA GPU and its driver`, { cause: error })
    }
    return { platform, hostname: os.hostname(), os: linuxName(fs.readFileSync('/etc/os-release', 'utf8'), os.release()), cpu, memoryGb, gpus: parseNvidiaGpus(listed), power: null }
  }
  const gpus = parseVideoControllers(read('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + "`t" + $_.DriverVersion }']))
  return { platform, hostname: os.hostname(), os: windowsName(os.release()), cpu, memoryGb, gpus, power: null }
}

/** The names of the machine's GPUs, as the report and the pages write them. */
export const gpuNames = (machine: Pick<MachineInfo, 'gpus'>): string => machine.gpus.map((gpu) => gpu.name).join(' + ')

/** How busy the machine was: the share of the CPUs' time spent working over a second, and the load average. */
export interface MachineLoad {
  cpuBusy: number
  /** The load average of the last minute; null on Windows, which keeps none. */
  loadAverage: number | null
}

/** The share of the CPUs' time spent working between two readings of `os.cpus()`. */
export function busyShare(before: readonly os.CpuInfo[], after: readonly os.CpuInfo[]): number {
  const total = (cpus: readonly os.CpuInfo[]): { idle: number; all: number } => cpus.reduce((sum, { times }) => ({
    idle: sum.idle + times.idle,
    all: sum.all + times.user + times.nice + times.sys + times.idle + times.irq
  }), { idle: 0, all: 0 })
  const [start, end] = [total(before), total(after)]
  const all = end.all - start.all
  if (all <= 0) throw new Error('the CPUs counted no time between two readings; read them further apart')
  return 1 - (end.idle - start.idle) / all
}

/** Measures how busy the machine is over one second, before a runtime starts and after it stops. */
export async function machineLoad(): Promise<MachineLoad> {
  const before = os.cpus()
  await new Promise((resolve) => setTimeout(resolve, 1000))
  return { cpuBusy: busyShare(before, os.cpus()), loadAverage: platformKey() === 'win32-x64' ? null : os.loadavg()[0]! }
}
