import { execFile } from 'node:child_process'
import type { GpuMeasure, Snapshot } from './snapshot.ts'

/** A way of looking at the machine's processes and their GPU memory again and again, every `intervalMs`. */
export interface Probe {
  readonly gpu: GpuMeasure
  /**
   * Starts looking and gives each snapshot to `take` with the root it was taken for. It resolves once the tools it
   * reads have answered, and rejects when one is missing or fails, so that a run does not start unmeasured.
   */
  start(root: () => number | null, take: (snapshot: Snapshot, root: number | null) => void): Promise<void>
  /** Stops looking, and rejects with the failure that stopped it earlier, if one did. */
  stop(): Promise<void>
}

/** A command's exit status and output, read whatever the status. */
export function runTool(command: string, args: readonly string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') return reject(new Error(`${command} could not be started (${error.message})`, { cause: error }))
      resolve({ status: error ? Number(error.code) : 0, stdout, stderr })
    })
  })
}
