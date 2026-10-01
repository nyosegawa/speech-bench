import { useCallback, useEffect, useState } from 'react'
import type { ApiError } from '@bench/web/api.ts'

export type { CampaignRow, ChooseAnswer, ChosenVoices, Job, ListenData, NeighborsData, RunRow, TrySet, VoiceDetail, VoiceLocales, VoiceRow, VoiceStepRequest } from '@bench/web/api.ts'

/** Reads a route of the bench's API, failing with the message its server gives. */
export const getJson = <T>(route: string, signal?: AbortSignal): Promise<T> => answerOf<T>(route, fetch(route, { signal }))

/** Sends a JSON body to a route of the bench's API, failing with the message its server gives. */
export const postJson = <T>(route: string, body: unknown): Promise<T> =>
  answerOf<T>(route, fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

async function answerOf<T>(route: string, request: Promise<Response>): Promise<T> {
  const response = await request
  if (!response.headers.get('content-type')?.startsWith('application/json')) {
    throw new Error(`${route} answered ${response.status} without JSON; start the bench's server with "npm run bench -- web"`)
  }
  const body: unknown = await response.json()
  if (!response.ok) throw new Error((body as ApiError).error)
  return body as T
}

export type Loaded<T> = { state: 'loading' } | { state: 'failed'; error: string } | { state: 'loaded'; data: T }

/** A route of the API, read again whenever the route changes or `reload` is called. */
export function useApi<T>(route: string): Loaded<T> & { reload: () => void } {
  const [answer, setAnswer] = useState<{ route: string; loaded: Loaded<T> } | null>(null)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((current) => current + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    getJson<T>(route, controller.signal).then(
      (data) => setAnswer({ route, loaded: { state: 'loaded', data } }),
      (error: unknown) => {
        if (!controller.signal.aborted) setAnswer({ route, loaded: { state: 'failed', error: error instanceof Error ? error.message : String(error) } })
      }
    )
    return () => controller.abort()
  }, [route, version])
  return { ...(answer?.route === route ? answer.loaded : { state: 'loading' }), reload }
}
