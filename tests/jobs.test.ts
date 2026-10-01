import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Job } from '../src/web/api.ts'
import { Jobs } from '../src/web/jobs.ts'
import { RequestError } from '../src/web/request-error.ts'

let data: string
beforeEach(() => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-test-'))
  process.env.SPEECH_BENCH_DATA = data
})
afterEach(() => {
  delete process.env.SPEECH_BENCH_DATA
  fs.rmSync(data, { recursive: true, force: true })
})

async function ended(job: Job): Promise<Job> {
  while (job.state === 'running') await new Promise((resolve) => setTimeout(resolve, 50))
  return job
}

describe('jobs', () => {
  it('runs one command at a time and keeps what it printed, in memory and in its log', async () => {
    const jobs = new Jobs()
    const job = jobs.start('models', ['models'])
    expect(() => jobs.start('models again', ['models'])).toThrow(RequestError)
    const done = await ended(job)
    expect(done.state).toBe('done')
    expect(done.lines.length).toBeGreaterThan(0)
    expect(fs.readFileSync(done.log, 'utf8')).toContain(done.lines[0]!)
    expect((await ended(jobs.start('models again', ['models']))).state).toBe('done')
  })

  it('stops a command that would otherwise run on', async () => {
    const jobs = new Jobs()
    const job = jobs.start('web', ['web', '--port', '0'])
    jobs.stop(job.id)
    expect((await ended(job)).state).toBe('stopped')
  })
})
