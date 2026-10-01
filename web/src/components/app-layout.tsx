import { AudioLines } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { cn } from '@/lib/utils.ts'

const LINKS = [{ to: '/', label: 'Runs' }]

export function AppLayout() {
  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex h-12 max-w-screen-2xl items-center gap-6 px-4">
          <NavLink to="/" className="flex items-center gap-2 font-semibold">
            <AudioLines className="size-5" />
            speech-bench
          </NavLink>
          <nav className="flex gap-4 text-sm">
            {LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} end className={({ isActive }) => cn('text-muted-foreground hover:text-foreground', isActive && 'text-foreground font-medium')}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
