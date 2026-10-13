import type os from 'node:os'
import { describe, expect, it } from 'vitest'
import { busyShare, parsePower, parseVideoControllers, windowsName } from '../src/core/platform.ts'

describe('windowsName', () => {
  it('tells Windows 11 from Windows 10 by the build, since both report version 10.0', () => {
    expect(windowsName('10.0.26200')).toBe('Windows 11 (build 26200)')
    expect(windowsName('10.0.19045')).toBe('Windows 10 (build 19045)')
  })
})

describe('the GPUs of a Windows machine', () => {
  it('reads each video controller\'s name and driver version', () => {
    expect(parseVideoControllers('NVIDIA GeForce RTX 2080\t32.0.15.8180\r\nIntel(R) UHD Graphics 630\t31.0.101.2125\r\n')).toEqual([
      { name: 'NVIDIA GeForce RTX 2080', driver: '32.0.15.8180' },
      { name: 'Intel(R) UHD Graphics 630', driver: '31.0.101.2125' }
    ])
  })

  it('refuses a controller without a driver version, rather than record one unknown', () => {
    expect(() => parseVideoControllers('Microsoft Basic Display Adapter\t\r\n')).toThrow(/driver version/)
  })
})

describe('a Mac\'s power', () => {
  // pmset on an Apple M5 with macOS 26.2, 2026-10-13.
  const battery = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=21692515)\t100%; charged; 0:00 remaining present: true\n"
  const settings = 'System-wide power settings:\nCurrently in use:\n standby              1\n lowpowermode         0\n powermode            0\n'

  it('reads the source of its power and whether Low Power Mode is on', () => {
    expect(parsePower(battery, settings)).toEqual({ source: 'ac', lowPowerMode: false })
    expect(parsePower(battery.replace('AC Power', 'Battery Power'), settings.replace('lowpowermode         0', 'lowpowermode         1'))).toEqual({ source: 'battery', lowPowerMode: true })
  })

  it('refuses output without them', () => {
    expect(() => parsePower(battery, 'System-wide power settings:\n')).toThrow(/Low Power Mode/)
  })
})

describe('how busy the CPUs were', () => {
  const cpu = (busy: number, idle: number): os.CpuInfo => ({ model: 'cpu', speed: 0, times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } })

  it('is the share of the time all CPUs spent working between two readings', () => {
    // One CPU worked 300 of 1000 ms and the other 100 of 1000 ms.
    expect(busyShare([cpu(1000, 5000), cpu(2000, 4000)], [cpu(1300, 5700), cpu(2100, 4900)])).toBeCloseTo(0.2)
  })

  it('refuses two readings with no time between them', () => {
    expect(() => busyShare([cpu(1, 1)], [cpu(1, 1)])).toThrow(/no time/)
  })
})
