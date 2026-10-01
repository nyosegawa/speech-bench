import { useEffect, useState } from 'react'
import type { ApiError } from '@bench/web/api.ts'

export type { CampaignRow, ListenData, RunRow } from '@bench/web/api.ts'

/** Reads a route of the bench's API, failing with the message its server gives. */
export async function getJson<T>(route: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(route, { signal })
  if (!response.headers.get('content-type')?.startsWith('application/json')) {
    throw new Error(`${route} answered ${response.status} without JSON; start the bench's server with "npm run bench -- web"`)
  }
  const body: unknown = await response.json()
  if (!response.ok) throw new Error((body as ApiError).error)
  return body as T
}

export type Loaded<T> = { state: 'loading' } | { state: 'failed'; error: string } | { state: 'loaded'; data: T }

/** A route of the API, read again whenever the route changes. */
export function useApi<T>(route: string): Loaded<T> {
  const [answer, setAnswer] = useState<{ route: string; loaded: Loaded<T> } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    getJson<T>(route, controller.signal).then(
      (data) => setAnswer({ route, loaded: { state: 'loaded', data } }),
      (error: unknown) => {
        if (!controller.signal.aborted) setAnswer({ route, loaded: { state: 'failed', error: error instanceof Error ? error.message : String(error) } })
      }
    )
    return () => controller.abort()
  }, [route])
  return answer?.route === route ? answer.loaded : { state: 'loading' }
}
