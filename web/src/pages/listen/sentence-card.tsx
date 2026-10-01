import { Play } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardContent, CardHeader } from '@/components/ui/card.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import type { ListenData } from '@/lib/api.ts'
import { percent } from '@/lib/format.ts'
import { cn } from '@/lib/utils.ts'
import { LIMITS, runColor } from '@/lib/figures.ts'
import type { Sentence, Take, TakeRef } from './listen-data.ts'
import { PlayedBar, type Player } from '@/components/player.tsx'

function TakeDetails({ take, reference }: { take: Take; reference: string | null }) {
  if (take.heardErrorRate === undefined) return <>{take.seconds.toFixed(1)} s</>
  const parts = [`${take.seconds.toFixed(1)} s`, ...(take.pitchHz ? [`${Math.round(take.pitchHz)} Hz`] : [])]
  return (
    <>
      {parts.join(' · ')}
      {' · '}
      {take.likeness === null || take.likeness === undefined
        ? <span title="Less than 1.5 s of voice, too little for a speaker embedding">too short to judge</span>
        : <span className={cn(take.likeness < LIMITS.oddTake && 'font-semibold text-red-700 dark:text-red-400')}>like the rest {take.likeness.toFixed(2)}</span>}
      {take.likeReference !== null && take.likeReference !== undefined && ` · like ${reference ?? 'its reference'} ${take.likeReference.toFixed(2)}`}
      {' · '}
      <span className={cn(take.heardErrorRate > LIMITS.broken && 'font-semibold text-red-700 dark:text-red-400')}>CER {percent(take.heardErrorRate)}</span>
    </>
  )
}

/** A sentence and a button for each run's take of it. */
export function SentenceCard({ data, sentence, index, player }: { data: ListenData; sentence: Sentence; index: number; player: Player<TakeRef> }) {
  const playing = player.current?.sentence === index ? player.current.run : null
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (playing !== null) card.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [playing])
  return (
    <Card ref={card} className={cn('scroll-mt-[calc(var(--sticky-height)+0.5rem)] gap-3 transition-shadow', playing !== null && 'ring-2 ring-primary/60')}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{index + 1} of {data.sentences.length} · {sentence.kind} · {sentence.id}</span>
        <Button size="sm" onClick={() => player.play(sentence.takes.flatMap((take, run) => (take ? [{ sentence: index, run }] : [])))}><Play />Every voice</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xl leading-relaxed">{sentence.text}</p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
          {sentence.takes.map((take, run) => {
            const button = (
              <button
                type="button"
                disabled={!take}
                onClick={() => player.play([{ sentence: index, run }])}
                style={runColor(run)}
                className={cn(
                  'relative overflow-hidden rounded-lg border border-l-4 border-l-(--run) px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted/60 disabled:cursor-default disabled:opacity-40',
                  playing === run && 'border-(--run) bg-[color-mix(in_oklab,var(--run)_14%,transparent)]'
                )}
              >
                <span className="flex items-center gap-1 font-medium break-all"><Play className="size-3 shrink-0" />{data.runs[run]!.name}</span>
                <span className="block text-xs text-muted-foreground tabular-nums">{take ? <TakeDetails take={take} reference={data.reference} /> : 'not spoken'}</span>
                {playing === run && <PlayedBar audio={player.audio} />}
              </button>
            )
            if (!take?.transcript) return <div key={run} className="grid">{button}</div>
            return (
              <Tooltip key={run}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent className="max-w-80">heard: {take.transcript}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
