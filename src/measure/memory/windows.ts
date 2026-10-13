import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import type { Probe } from './probe.ts'
import type { ProcessRow, Snapshot } from './snapshot.ts'

/**
 * On Windows the resident memory of a process is its working set, and its GPU memory the dedicated GPU memory WDDM
 * counts for it, both read from Windows' performance counters, which a user reads without being an administrator.
 * nvidia-smi gives no memory per process under WDDM, only "[N/A]", and the memory in use on the whole GPU would count
 * every other program's.
 */

/**
 * A PowerShell script that reads the counters of every process and the dedicated GPU memory of every process that has
 * some, every `intervalMs`, and writes each look as one line of JSON. Reading a whole category at once takes every
 * counter of it at one moment, so that a process's parent and working set are of the same instant.
 */
export const countersScript = (intervalMs: number): string => `
$ErrorActionPreference = 'Stop'
$processes = New-Object System.Diagnostics.PerformanceCounterCategory 'Process'
$gpu = New-Object System.Diagnostics.PerformanceCounterCategory 'GPU Process Memory'
$clock = [System.Diagnostics.Stopwatch]::StartNew()
while ($true) {
  $began = $clock.ElapsedMilliseconds
  $read = $processes.ReadCategory()
  $ids = $read['ID Process']; $parents = $read['Creating Process ID']; $sets = $read['Working Set']
  $rows = New-Object System.Collections.Generic.List[string]
  foreach ($name in $ids.Keys) { $rows.Add('[' + $ids[$name].RawValue + ',' + $parents[$name].RawValue + ',' + $sets[$name].RawValue + ']') }
  $dedicated = $gpu.ReadCategory()['Dedicated Usage']
  $held = New-Object System.Collections.Generic.List[string]
  foreach ($name in $dedicated.Keys) { $bytes = $dedicated[$name].RawValue; if ($bytes -gt 0) { $held.Add('["' + $name + '",' + $bytes + ']') } }
  [Console]::Out.WriteLine('{"processes":[' + ($rows -join ',') + '],"gpu":[' + ($held -join ',') + ']}')
  [Console]::Out.Flush()
  $rest = ${intervalMs} - ($clock.ElapsedMilliseconds - $began)
  if ($rest -gt 0) { Start-Sleep -Milliseconds $rest }
}
`

/** An instance of the GPU Process Memory counters, one for each process and adapter: `pid_1234_luid_0x…_phys_0`. */
const INSTANCE = /^pid_(\d+)_/

/** One line of `countersScript`, the GPU memory of a process on every adapter added up. */
export function parseCountersLine(line: string): Snapshot {
  let parsed: { processes?: unknown; gpu?: unknown }
  try {
    parsed = JSON.parse(line) as typeof parsed
  } catch {
    throw new Error(`the counters of Windows gave a line that is not JSON: ${line.slice(0, 200)}`)
  }
  const { processes, gpu } = parsed
  if (!Array.isArray(processes) || !Array.isArray(gpu)) throw new Error(`the counters of Windows gave a line without processes or GPU memory: ${line.slice(0, 200)}`)
  const rows: ProcessRow[] = processes.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== 3 || !row.every((value) => Number.isInteger(value))) throw new Error(`the counters of Windows gave a process that is not a pid, a parent and a working set: ${JSON.stringify(row)}`)
    const [pid, parent, residentBytes] = row as [number, number, number]
    return { pid, parent, residentBytes }
  })
  const gpuBytes = new Map<number, number>()
  for (const held of gpu as unknown[]) {
    const [instance, bytes] = Array.isArray(held) ? held : []
    const pid = typeof instance === 'string' ? INSTANCE.exec(instance)?.[1] : undefined
    if (pid === undefined || !Number.isInteger(bytes)) throw new Error(`the counters of Windows gave GPU memory that is not an instance of a process and its bytes: ${JSON.stringify(held)}`)
    gpuBytes.set(Number(pid), (gpuBytes.get(Number(pid)) ?? 0) + (bytes as number))
  }
  return { processes: rows, gpuBytes }
}

/** Reads the counters through one PowerShell process that keeps running while the runtime does. */
export class WindowsProbe implements Probe {
  readonly gpu = 'dedicated' as const
  private readonly intervalMs: number
  private child: ChildProcessWithoutNullStreams | null = null
  private failure: Error | null = null

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs
  }

  start(root: () => number | null, take: (snapshot: Snapshot, root: number | null) => void): Promise<void> {
    // Windows PowerShell 5.1 takes the double quotes of a script given with -Command apart; an encoded one arrives whole.
    const encoded = Buffer.from(countersScript(this.intervalMs), 'utf16le').toString('base64')
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (text: string) => { stderr += text })
    return new Promise((resolve, reject) => {
      let started = false
      const fail = (error: Error): void => {
        if (!started) return reject(error)
        this.failure ??= error
      }
      child.once('error', (error) => fail(new Error(`PowerShell could not be started to read the memory counters (${error.message})`, { cause: error })))
      child.once('exit', (code) => {
        if (this.child === child) fail(new Error(`PowerShell stopped reading the memory counters with code ${String(code)}: ${stderr.trim() || 'no message'}; a Windows without the GPU Process Memory counters (Windows 10 1709 or later with a WDDM 2 driver) cannot measure GPU memory`))
      })
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        try {
          const pid = root()
          take(parseCountersLine(line), pid)
          if (!started) {
            started = true
            resolve()
          }
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
          child.kill()
        }
      })
    })
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    if (child && child.exitCode === null) {
      await new Promise((resolve) => {
        child.once('exit', resolve)
        child.kill()
      })
    }
    if (this.failure) throw this.failure
  }
}
