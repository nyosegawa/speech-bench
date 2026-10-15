import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { GpuPowerSampler, hasNvidiaGpu, parsePowerLine, powerOf } from '../src/measure/gpu-power.ts'

describe('the power of NVIDIA GPUs', () => {
  it('reads the time, the GPU and its power from a line of nvidia-smi', () => {
    expect(parsePowerLine('2026/10/13 17:02:11.123, 0, 45.32')).toEqual({ timestamp: '2026/10/13 17:02:11.123', index: 0, watts: 45.32 })
  })

  it('refuses a GPU that reads no power, rather than record none', () => {
    expect(() => parsePowerLine('2026/10/13 17:02:11.123, 0, [N/A]')).toThrow(/no power draw/)
  })

  it('adds the GPUs of one reading before taking the peak and the mean', () => {
    const readings = ['t1, 0, 40', 't1, 1, 20', 't2, 0, 200', 't2, 1, 25', 't3, 0, 60', 't3, 1, 15'].map(parsePowerLine)
    expect(powerOf(readings)).toEqual({ peakWatts: 225, meanWatts: (60 + 225 + 75) / 3, samples: 3 })
  })

  it('refuses a run during which nvidia-smi read nothing', () => {
    expect(() => powerOf([])).toThrow(/no reading/)
  })

  it('is read on Windows and Linux from an NVIDIA GPU alone', () => {
    expect(hasNvidiaGpu({ platform: 'win32-x64', gpus: [{ name: 'NVIDIA GeForce RTX 2080', driver: '32.0.15.8180' }] })).toBe(true)
    expect(hasNvidiaGpu({ platform: 'linux-x64', gpus: [{ name: 'NVIDIA H100 80GB HBM3', driver: '570.172.08' }] })).toBe(true)
    expect(hasNvidiaGpu({ platform: 'win32-x64', gpus: [{ name: 'AMD Radeon RX 7900 XTX', driver: '32.0.12011.1036' }] })).toBe(false)
    expect(hasNvidiaGpu({ platform: 'darwin-arm64', gpus: [{ name: 'Apple M5', driver: null }] })).toBe(false)
  })
})

describe('GpuPowerSampler', () => {
  it('ignores the piece of a line nvidia-smi leaves when it is stopped', async () => {
    // Writes a reading every 20 ms, and on SIGTERM the time of a reading alone, as nvidia-smi stopped mid-line did.
    const script = [
      "let n = 0",
      "const timer = setInterval(() => process.stdout.write(`2026/10/14 03:00:${String(n++).padStart(2, '0')}.000, 0, 40\\n`), 20)",
      "process.on('SIGTERM', () => { clearInterval(timer); process.stdout.write('2026/10/14 03:00:52.468', () => process.exit(0)) })"
    ].join('\n')
    const child = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const sampler = await GpuPowerSampler.reading(child, process.execPath)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const power = await sampler.stop()
    expect(power.peakWatts).toBe(40)
    expect(power.samples).toBeGreaterThan(0)
  })
})
