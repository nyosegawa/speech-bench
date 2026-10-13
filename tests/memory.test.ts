import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { graphicsBytes, parsePs } from '../src/measure/memory/macos.ts'
import { PeakMemory, processTree, type ProcessRow, type Snapshot } from '../src/measure/memory/snapshot.ts'
import { parseCountersLine, WindowsProbe } from '../src/measure/memory/windows.ts'

const MIB = 1024 * 1024
const row = (pid: number, parent: number, mib: number): ProcessRow => ({ pid, parent, residentBytes: mib * MIB })
const snapshot = (processes: ProcessRow[], gpu: Array<[number, number]> = []): Snapshot => ({ processes, gpuBytes: new Map(gpu.map(([pid, mib]) => [pid, mib * MIB])) })

describe('the process tree', () => {
  const processes = [row(1, 0, 1), row(50, 1, 1), row(100, 50, 10), row(101, 100, 200), row(102, 101, 30), row(200, 50, 5)]

  it('holds the root and every process under it, and no process beside it', () => {
    expect([...processTree(processes, 100)].sort()).toEqual([100, 101, 102])
  })

  it('is empty once the root has exited, though its children remain', () => {
    expect(processTree(processes.filter(({ pid }) => pid !== 100), 100).size).toBe(0)
  })

  it('ends at a process that is its own parent, as Windows lists its idle process', () => {
    expect([...processTree([row(0, 0, 0), row(4, 0, 1)], 0)].sort()).toEqual([0, 4])
  })
})

describe('the peak memory of a process tree', () => {
  it('is the largest sum of one sample, not the sum of each process at its own peak', () => {
    const peak = new PeakMemory(100, 'metal')
    // uv holds 20 MiB throughout; Python loads 1000 MiB and then frees half of it.
    peak.add(snapshot([row(10, 1, 20), row(11, 10, 1000)], [[11, 300]]), 10)
    peak.add(snapshot([row(10, 1, 60), row(11, 10, 500)], [[11, 900]]), 10)
    expect(peak.record()).toEqual({ intervalMs: 100, samples: 2, peakResidentBytes: 1020 * MIB, gpu: { measure: 'metal', peakBytes: 900 * MIB } })
  })

  it('leaves out the samples before the runtime started and after it exited, and every process outside it', () => {
    const peak = new PeakMemory(100, 'dedicated')
    peak.add(snapshot([row(1, 0, 5000)], [[1, 4000]]), null)
    peak.add(snapshot([row(1, 0, 5000), row(10, 1, 100)], [[1, 4000], [10, 700]]), 10)
    peak.add(snapshot([row(1, 0, 5000)], [[1, 4000]]), 10)
    expect(peak.record()).toEqual({ intervalMs: 100, samples: 1, peakResidentBytes: 100 * MIB, gpu: { measure: 'dedicated', peakBytes: 700 * MIB } })
  })

  it('records a runtime that held no GPU memory on a machine with a discrete GPU as zero', () => {
    const peak = new PeakMemory(100, 'dedicated')
    peak.add(snapshot([row(1, 0, 50), row(10, 1, 100)], [[1, 300]]), 10)
    expect(peak.record().gpu).toEqual({ measure: 'dedicated', peakBytes: 0 })
  })

  it('records no GPU memory on a machine where no process held dedicated GPU memory', () => {
    const peak = new PeakMemory(100, 'dedicated')
    peak.add(snapshot([row(1, 0, 50), row(10, 1, 100)]), 10)
    expect(peak.record().gpu).toBeNull()
  })

  it('refuses to record a runtime it never saw, rather than record zeros', () => {
    const peak = new PeakMemory(100, 'metal')
    peak.add(snapshot([row(1, 0, 50)]), 10)
    expect(() => peak.record()).toThrow(/never sampled/)
  })
})

describe('reading the memory on macOS', () => {
  it('reads the pid, the parent and the RSS in KiB of each process ps lists', () => {
    expect(parsePs('    1     0  17408\n  111 54673   1120\n')).toEqual([{ pid: 1, parent: 0, residentBytes: 17408 * 1024 }, { pid: 111, parent: 54673, residentBytes: 1120 * 1024 }])
    expect(() => parsePs('  PID  PPID   RSS\n')).toThrow(/not a pid/)
  })

  it('counts the categories footprint tags as graphics, mapped or not, and no other', () => {
    // A process that allocated and filled a 64 MiB private Metal buffer, and the shell that started it (Apple M5, 2026-10-13).
    const json: unknown = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'footprint.json'), 'utf8'))
    expect(graphicsBytes(json)).toEqual(new Map([[35007, 64 * MIB + 128 * 1024], [35006, 0]]))
  })

  it('refuses JSON that is not footprint\'s', () => {
    expect(() => graphicsBytes({ processes: [{ pid: 1 }] })).toThrow(/categories/)
    expect(() => graphicsBytes({})).toThrow(/processes/)
  })
})

describe('reading the memory on Windows', () => {
  it('adds up the dedicated GPU memory of a process on every adapter', () => {
    const line = '{"processes":[[0,0,8192],[4,0,151552],[5120,880,52428800]],"gpu":[["pid_5120_luid_0x00000000_0x0000D1B5_phys_0",1073741824],["pid_5120_luid_0x00000000_0x0000E2C6_phys_0",4096],["pid_1640_luid_0x00000000_0x0000D1B5_phys_0",65536]]}'
    const { processes, gpuBytes } = parseCountersLine(line)
    expect(processes).toEqual([{ pid: 0, parent: 0, residentBytes: 8192 }, { pid: 4, parent: 0, residentBytes: 151552 }, { pid: 5120, parent: 880, residentBytes: 52428800 }])
    expect(gpuBytes).toEqual(new Map([[5120, 1073741824 + 4096], [1640, 65536]]))
  })

  it('refuses a line that a missing counter left incomplete', () => {
    expect(() => parseCountersLine('{"processes":[[5120,,52428800]],"gpu":[]}')).toThrow(/not JSON/)
    expect(() => parseCountersLine('{"processes":[[5120,52428800]],"gpu":[]}')).toThrow(/pid, a parent and a working set/)
    expect(() => parseCountersLine('{"processes":[],"gpu":[["luid_0x00000000_0x0000D1B5_phys_0",1]]}')).toThrow(/instance of a process/)
  })
})

describe('the Windows probe', () => {
  it('ignores the piece of a line PowerShell leaves when it is stopped', async () => {
    // Writes a look every 20 ms, and on SIGTERM the start of one, as PowerShell stopped mid-line did.
    const script = [
      "const look = JSON.stringify({ processes: [[10, 1, 4096]], gpu: [] })",
      "const timer = setInterval(() => process.stdout.write(look + '\\n'), 20)",
      "process.on('SIGTERM', () => { clearInterval(timer); process.stdout.write('{\"processes\":[[34720,1776,45133824],[20932,130', () => process.exit(0)) })"
    ].join('\n')
    const child = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const looks: Snapshot[] = []
    const probe = new WindowsProbe(20)
    await probe.reading(child, () => 10, (snapshot) => looks.push(snapshot))
    await new Promise((resolve) => setTimeout(resolve, 100))
    await probe.stop()
    expect(looks.length).toBeGreaterThan(0)
    expect(looks.every((look) => look.processes[0]?.residentBytes === 4096)).toBe(true)
  })
})
