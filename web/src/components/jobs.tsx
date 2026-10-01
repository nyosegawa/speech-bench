import { Square } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { getJson, postJson, type Job, type VoiceStepRequest } from '@/lib/api.ts'
import { cn } from '@/lib/utils.ts'

/** How often the jobs are read while one runs. */
const POLL_MS = 1_000

interface JobsState {
  jobs: Job[]
  error: string | null
  running: Job | null
  start: (request: VoiceStepRequest) => void
  stop: (id: string) => void
}

const JobsContext = createContext<JobsState | null>(null)

/** The jobs the bench runs for the app, read again every second while one runs, for every page to share. */
export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState<string | null>(null)
  const fail = useCallback((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)), [])
  const read = useCallback(() => getJson<Job[]>('/api/jobs').then(setJobs, fail), [fail])
  const running = jobs.find((job) => job.state === 'running') ?? null

  useEffect(() => {
    void read()
  }, [read])
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => void read(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [running, read])

  const start = useCallback((request: VoiceStepRequest) => {
    setError(null)
    postJson<Job>('/api/jobs', request).then(read, fail)
  }, [read, fail])
  const stop = useCallback((id: string) => {
    postJson<Job>(`/api/jobs/${id}/stop`, {}).then(read, fail)
  }, [read, fail])

  return <JobsContext.Provider value={{ jobs, error, running, start, stop }}>{children}</JobsContext.Provider>
}

export function useJobs(): JobsState {
  const state = useContext(JobsContext)
  if (!state) throw new Error('useJobs is used outside JobsProvider')
  return state
}

/** Calls `onEnd` when a job the filter takes has ended, so that a page reads again what the job made. */
export function useJobEnd(take: (job: Job) => boolean, onEnd: () => void): void {
  const { jobs } = useJobs()
  const seen = useRef(new Set<string>())
  useEffect(() => {
    for (const job of jobs) {
      if (!take(job) || job.state === 'running' || seen.current.has(job.id)) continue
      seen.current.add(job.id)
      if (job.endedAt && Date.now() - Date.parse(job.endedAt) < 10 * POLL_MS) onEnd()
    }
  }, [jobs, take, onEnd])
}

const STATE_BADGE: Record<Job['state'], string> = {
  running: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  failed: 'bg-red-500/15 text-red-700 dark:text-red-300',
  stopped: 'bg-muted text-muted-foreground'
}

/** A job with its last lines of output, and a button that stops it while it runs. */
export function JobLog({ job, lines = 20 }: { job: Job; lines?: number }) {
  const { stop } = useJobs()
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge className={cn('border-transparent', STATE_BADGE[job.state])}>{job.state}</Badge>
        <span className="font-medium">{job.title}</span>
        <span className="text-xs text-muted-foreground">{new Date(job.startedAt).toLocaleTimeString()}{job.endedAt && ` – ${new Date(job.endedAt).toLocaleTimeString()}`}</span>
        {job.state === 'running' && <Button variant="outline" size="xs" className="ml-auto" onClick={() => stop(job.id)}><Square />Stop</Button>}
      </div>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">{job.lines.slice(-lines).join('\n') || ' '}</pre>
      <div className="truncate font-mono text-xs text-muted-foreground" title={job.log}>{job.command} · {job.log}</div>
    </div>
  )
}
