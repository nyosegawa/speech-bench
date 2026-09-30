import { execFileSync } from 'node:child_process'
import os from 'node:os'

/** The two systems ASIST ships on, which are the ones worth measuring. */
export type PlatformKey = 'darwin-arm64' | 'win32-x64'

export function platformKey(): PlatformKey {
  const key = `${process.platform}-${process.arch}`
  if (key === 'darwin-arm64' || key === 'win32-x64') return key
  throw new Error(`speech-bench runs on macOS arm64 and Windows x64, not ${key}`)
}

/** The GPU interface ggml runs on here: Metal on a Mac, Vulkan on Windows, as ASIST uses them. */
export const gpuBackend = (): 'metal' | 'vulkan' => (platformKey() === 'darwin-arm64' ? 'metal' : 'vulkan')

/**
 * The GPU the runtimes are told to use, in ggml's device names; SPEECH_BENCH_DEVICE picks another, for
 * example Vulkan1 on a Windows machine with two GPUs.
 */
export const gpuDevice = (): string => process.env.SPEECH_BENCH_DEVICE?.trim() || (gpuBackend() === 'metal' ? 'MTL0' : 'Vulkan0')

/** What a result was measured on, stored with every run so that runs from several machines can be compared. */
export interface MachineInfo {
  platform: PlatformKey
  hostname: string
  os: string
  cpu: string
  memoryGb: number
  gpus: string[]
}

/**
 * Windows 11 reports itself as version 10.0 like Windows 10; its builds start at 22000, so the build number
 * is what tells them apart.
 */
export function windowsName(release: string): string {
  const build = Number(release.split('.')[2])
  return `Windows ${build >= 22_000 ? '11' : '10'} (build ${build})`
}

const read = (command: string, args: string[]): string =>
  execFileSync(command, args, { encoding: 'utf8', windowsHide: true }).trim()

export function machineInfo(): MachineInfo {
  const platform = platformKey()
  const cpu = platform === 'darwin-arm64' ? read('sysctl', ['-n', 'machdep.cpu.brand_string']) : os.cpus()[0]?.model.trim() ?? 'unknown'
  const system = platform === 'darwin-arm64' ? `macOS ${read('sw_vers', ['-productVersion'])}` : windowsName(os.release())
  // On a Mac the GPU is part of the chip that names the CPU.
  const gpus = platform === 'darwin-arm64'
    ? [cpu]
    : read('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name']).split(/\r?\n/).map((name) => name.trim()).filter(Boolean)
  return { platform, hostname: os.hostname(), os: system, cpu, memoryGb: Math.round(os.totalmem() / 1024 ** 3), gpus }
}
