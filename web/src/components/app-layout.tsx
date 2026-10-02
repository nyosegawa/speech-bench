import { AudioLines, Loader2 } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router'
import { JobsProvider, useJobs } from '@/components/jobs.tsx'
import { cn } from '@/lib/utils.ts'

const LINKS = [{ to: '/', label: 'Runs', end: true }, { to: '/voices', label: 'Voices', end: false }, { to: '/record', label: 'Record', end: false }, { to: '/spellings', label: 'Spellings', end: false }, { to: '/jobs', label: 'Jobs', end: false }]

/** The job that runs, if one does, on every page. */
function RunningJob() {
  const { running } = useJobs()
  if (!running) return null
  return (
    <Link to="/jobs" className="ml-auto flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
      <Loader2 className="size-4 animate-spin" />
      {running.title}
    </Link>
  )
}

export function AppLayout() {
  return (
    <JobsProvider>
      <div className="min-h-svh">
        <header className="border-b">
          <div className="mx-auto flex h-12 max-w-screen-2xl items-center gap-6 px-4">
            <NavLink to="/" className="flex items-center gap-2 font-semibold">
              <AudioLines className="size-5" />
              speech-bench
            </NavLink>
            <nav className="flex gap-4 text-sm">
              {LINKS.map((link) => (
                <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => cn('text-muted-foreground hover:text-foreground', isActive && 'text-foreground font-medium')}>
                  {link.label}
                </NavLink>
              ))}
            </nav>
            <RunningJob />
          </div>
        </header>
        <Outlet />
      </div>
    </JobsProvider>
  )
}
