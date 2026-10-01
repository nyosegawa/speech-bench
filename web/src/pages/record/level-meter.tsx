import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils.ts'
import { CLIP, decibels, FLOOR_DB, formatDb, HOT_DB, meterShare, QUIET_DB } from './audio.ts'
import type { Capture } from './capture.ts'

const TICKS = [FLOOR_DB, -45, -30, -15, 0]

/** The input level while recording, falling back slowly, with the loudest level held and the time so far. */
export function LevelMeter({ capture }: { capture: Capture | null }) {
  const [state, setState] = useState({ db: -Infinity, heldDb: -Infinity, seconds: 0, clipped: false })
  const shown = useRef({ level: 0, held: 0 })

  useEffect(() => {
    shown.current = { level: 0, held: 0 }
    setState({ db: -Infinity, heldDb: -Infinity, seconds: 0, clipped: false })
    if (!capture) return
    let frame = 0
    const draw = (): void => {
      const { meter } = capture
      shown.current.level = Math.max(meter.recent, shown.current.level * 0.85)
      shown.current.held = Math.max(shown.current.held, meter.recent)
      meter.recent = 0
      setState({ db: decibels(shown.current.level), heldDb: decibels(shown.current.held), seconds: (performance.now() - capture.startedAt) / 1000, clipped: meter.clipped })
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [capture])

  return (
    <div className="space-y-1">
      <div className="relative h-3 overflow-hidden rounded-full bg-muted" aria-label="input level">
        <div className="absolute inset-y-0 border-l border-dashed border-amber-500" style={{ left: `${meterShare(QUIET_DB)}%` }} />
        <div className="absolute inset-y-0 border-l border-dashed border-red-500" style={{ left: `${meterShare(HOT_DB)}%` }} />
        <div
          className={cn('h-full rounded-full transition-[width] duration-75', state.clipped || shown.current.level >= CLIP ? 'bg-red-500' : state.db > HOT_DB ? 'bg-amber-500' : 'bg-emerald-500')}
          style={{ width: `${meterShare(state.db)}%` }}
        />
        {capture && Number.isFinite(state.heldDb) && <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${meterShare(state.heldDb)}%` }} />}
      </div>
      <div className="relative h-4 text-[10px] text-muted-foreground" aria-hidden>
        {TICKS.map((db, index) => (
          <span key={db} className={cn('absolute whitespace-nowrap', index === 0 ? '' : index === TICKS.length - 1 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: `${meterShare(db)}%` }}>{db} dB</span>
        ))}
      </div>
      {capture && (
        <p className={cn('text-sm tabular-nums', state.clipped ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
          Recording {state.seconds.toFixed(1)} s · now {formatDb(state.db)} · loudest {formatDb(state.heldDb)}{state.clipped && ' · clipped'}
        </p>
      )}
    </div>
  )
}
