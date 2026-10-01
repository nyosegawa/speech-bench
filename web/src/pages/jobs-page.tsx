import { Failure } from '@/components/failure.tsx'
import { JobLog, useJobs } from '@/components/jobs.tsx'

/** The commands the app started since the bench's server started, newest first. */
export function JobsPage() {
  const { jobs, error } = useJobs()
  return (
    <main className="mx-auto max-w-screen-2xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold">Jobs</h1>
        <p className="text-sm text-muted-foreground">Steps of making a voice run here one at a time, since each holds the GPU. Each keeps its whole output in its log file.</p>
      </div>
      {error && <Failure error={error} />}
      {jobs.length === 0 && <p className="text-sm text-muted-foreground">No job has run since the server started.</p>}
      {jobs.map((job) => <JobLog key={job.id} job={job} lines={60} />)}
    </main>
  )
}
