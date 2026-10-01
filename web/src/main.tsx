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
      { path: 'listen', lazy: async () => ({ Component: (await import('@/pages/listen/listen-page.tsx')).ListenPage }) }
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
