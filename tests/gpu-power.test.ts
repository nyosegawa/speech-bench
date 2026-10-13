import { describe, expect, it } from 'vitest'
import { hasNvidiaGpu, parsePowerLine, powerOf } from '../src/measure/gpu-power.ts'

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

  it('is read on Windows from an NVIDIA GPU alone', () => {
    expect(hasNvidiaGpu({ platform: 'win32-x64', gpus: [{ name: 'NVIDIA GeForce RTX 2080', driver: '32.0.15.8180' }] })).toBe(true)
    expect(hasNvidiaGpu({ platform: 'win32-x64', gpus: [{ name: 'AMD Radeon RX 7900 XTX', driver: '32.0.12011.1036' }] })).toBe(false)
    expect(hasNvidiaGpu({ platform: 'darwin-arm64', gpus: [{ name: 'Apple M5', driver: null }] })).toBe(false)
  })
})
