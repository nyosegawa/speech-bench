import { RotateCw } from 'lucide-react'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx'

/** What a page that failed to render shows in place of React Router's page for developers. */
export function AppError() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : String(error)
  return (
    <main className="mx-auto max-w-screen-md px-4 py-10">
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">This page failed</CardTitle>
          <CardDescription className="font-mono text-xs whitespace-pre-wrap">{message}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button size="sm" onClick={() => window.location.reload()}><RotateCw />Reload</Button>
          <Button size="sm" variant="outline" asChild><Link to="/" reloadDocument>Back to the runs</Link></Button>
        </CardContent>
      </Card>
    </main>
  )
}
