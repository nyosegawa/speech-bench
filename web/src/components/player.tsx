import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface Player<T> {
  audio: HTMLAudioElement
  current: T | null
  error: string | null
  play: (items: readonly T[]) => void
  stop: () => void
}

/** Plays items one after another until the list ends or Escape is pressed; `urlOf` gives each item's audio. */
export function usePlayer<T>(urlOf: (item: T) => string): Player<T> {
  const audio = useMemo(() => new Audio(), [])
  const queue = useRef<T[]>([])
  const urlOfLatest = useRef(urlOf)
  urlOfLatest.current = urlOf
  const [current, setCurrent] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    queue.current = []
    audio.pause()
    setCurrent(null)
  }, [audio])

  const next = useCallback(() => {
    const item = queue.current.shift() ?? null
    setCurrent(item)
    if (item === null) {
      audio.pause()
      return
    }
    audio.src = urlOfLatest.current(item)
    audio.play().catch((reason: unknown) => {
      // Starting another item while one loads aborts the first; that is not a failure.
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(`could not play ${audio.src}: ${reason instanceof Error ? reason.message : String(reason)}`)
      stop()
    })
  }, [audio, stop])

  const play = useCallback((items: readonly T[]) => {
    setError(null)
    queue.current = [...items]
    next()
  }, [next])

  useEffect(() => {
    audio.addEventListener('ended', next)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') stop()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      audio.removeEventListener('ended', next)
      document.removeEventListener('keydown', onKey)
      audio.pause()
    }
  }, [audio, next, stop])

  return { audio, current, error, play, stop }
}

/** How far the item that is playing has played, from 0 to 1. */
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

/** A bar along the bottom of what is playing, in the color `--run` of its element. */
export function PlayedBar({ audio }: { audio: HTMLAudioElement }) {
  const share = usePlayedShare(audio)
  return <span className="absolute bottom-0 left-0 h-0.5 bg-(--run)" style={{ width: `${share * 100}%` }} />
}
