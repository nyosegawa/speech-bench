import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { AppLayout } from '@/components/app-layout.tsx'
import { TooltipProvider } from '@/components/ui/tooltip.tsx'
import { RunsPage } from '@/pages/runs-page.tsx'
import './index.css'

const dark = window.matchMedia('(prefers-color-scheme: dark)')
const followScheme = (): void => {
  document.documentElement.classList.toggle('dark', dark.matches)
}
followScheme()
dark.addEventListener('change', followScheme)

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <RunsPage /> },
      { path: 'listen', lazy: async () => ({ Component: (await import('@/pages/listen/listen-page.tsx')).ListenPage }) },
      { path: 'record', lazy: async () => ({ Component: (await import('@/pages/record/speakers-page.tsx')).SpeakersPage }) },
      { path: 'record/:locale/:speaker', lazy: async () => ({ Component: (await import('@/pages/record/recorder-page.tsx')).RecorderPage }) },
      { path: 'jobs', lazy: async () => ({ Component: (await import('@/pages/jobs-page.tsx')).JobsPage }) },
      { path: 'transcripts', lazy: async () => ({ Component: (await import('@/pages/transcripts-page.tsx')).TranscriptsPage }) },
      { path: 'neighbors', lazy: async () => ({ Component: (await import('@/pages/neighbors/neighbors-page.tsx')).NeighborsPage }) },
      { path: 'voices', lazy: async () => ({ Component: (await import('@/pages/voices/voices-page.tsx')).VoicesPage }) },
      { path: 'voices/:id', lazy: async () => ({ Component: (await import('@/pages/voices/voice-page.tsx')).VoicePage }) }
    ]
  }
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  </StrictMode>
)
