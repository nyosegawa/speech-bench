import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ListenData } from '@/lib/api.ts'

/** A take: one sentence as one run spoke it, by their places on the page. */
export interface TakeRef {
  sentence: number
  run: number
}

export interface Player {
  audio: HTMLAudioElement
  current: TakeRef | null
  error: string | null
  play: (takes: readonly TakeRef[]) => void
  stop: () => void
}

/** Plays takes one after another until the list ends or Escape is pressed. */
export function usePlayer(data: ListenData): Player {
  const audio = useMemo(() => new Audio(), [])
  const queue = useRef<TakeRef[]>([])
  const [current, setCurrent] = useState<TakeRef | null>(null)
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    queue.current = []
    audio.pause()
    setCurrent(null)
  }, [audio])

  const next = useCallback(() => {
    const take = queue.current.shift() ?? null
    setCurrent(take)
    if (!take) {
      audio.pause()
      return
    }
    audio.src = data.sentences[take.sentence]!.takes[take.run]!.url
    audio.play().catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(`could not play ${audio.src}: ${reason instanceof Error ? reason.message : String(reason)}`)
      stop()
    })
  }, [audio, data, stop])

  const play = useCallback((takes: readonly TakeRef[]) => {
    setError(null)
    queue.current = takes.filter(({ sentence, run }) => data.sentences[sentence]?.takes[run])
    next()
  }, [data, next])

  useEffect(() => {
    audio.addEventListener('ended', next)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') stop()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      audio.removeEventListener('ended', next)
      document.removeEventListener('keydown', onKey)
    }
  }, [audio, next, stop])

  useEffect(() => stop, [data, stop])

  return { audio, current, error, play, stop }
}

/** How far the take that is playing has played, from 0 to 1. */
export function usePlayedShare(audio: HTMLAudioElement): number {
  const [share, setShare] = useState(0)
  useEffect(() => {
    const update = (): void => setShare(audio.duration ? audio.currentTime / audio.duration : 0)
    update()
    audio.addEventListener('timeupdate', update)
    return () => audio.removeEventListener('timeupdate', update)
  }, [audio])
  return share
}
