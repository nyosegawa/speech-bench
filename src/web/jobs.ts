import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { logsDir } from '../core/paths.ts'
import type { Job } from './api.ts'

const CLI = path.join(import.meta.dirname, '..', 'cli.ts')

/** The lines of a job's output the app is sent; the whole output stays in the job's log file. */
const KEPT_LINES = 200

/** The jobs kept in memory for the app to list, newest first. */
const KEPT_JOBS = 20

export class JobError extends Error {}

/**
 * Commands of the bench run for the web app, one at a time since each holds the GPU, with their output kept in a
 * log file and its last lines in memory.
 */
export class Jobs {
  private readonly jobs: Job[] = []
  private running: { job: Job; child: ChildProcess } | null = null
  private started = 0

  list(): Job[] {
    return [...this.jobs]
  }

  /** Starts `node src/cli.ts ...args`, or refuses while another job runs. */
  start(title: string, args: readonly string[]): Job {
    if (this.running) throw new JobError(`${this.running.job.title} is running; wait for it or stop it first`)
    const startedAt = new Date()
    this.started += 1
    const id = `${startedAt.toISOString().replace(/[:.]/g, '-')}-${this.started}`
    fs.mkdirSync(logsDir(), { recursive: true })
    const log = path.join(logsDir(), `job-${id}.log`)
    const job: Job = { id, title, command: ['node', 'src/cli.ts', ...args].join(' '), startedAt: startedAt.toISOString(), endedAt: null, state: 'running', exitCode: null, log, lines: [] }
    const output = fs.createWriteStream(log)
    const child = spawn(process.execPath, [CLI, ...args], { cwd: path.dirname(path.dirname(CLI)), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let partial = ''
    const take = (chunk: Buffer): void => {
      output.write(chunk)
      // Progress lines end in a carriage return to overwrite themselves on a terminal; each is kept as a line here.
      const text = partial + chunk.toString('utf8')
      const lines = text.split(/\r?\n|\r/)
      partial = lines.pop() ?? ''
      job.lines.push(...lines)
      job.lines.splice(0, Math.max(0, job.lines.length - KEPT_LINES))
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.on('close', (code, signal) => {
      if (partial) job.lines.push(partial)
      output.end()
      job.endedAt = new Date().toISOString()
      job.exitCode = code
      job.state = signal !== null ? 'stopped' : code === 0 ? 'done' : 'failed'
      this.running = null
    })
    this.running = { job, child }
    this.jobs.unshift(job)
    this.jobs.splice(KEPT_JOBS)
    return job
  }

  stop(id: string): Job {
    if (this.running?.job.id !== id) throw new JobError(`job ${id} is not running`)
    this.running.child.kill()
    return this.running.job
  }
}
