import { ArrowLeft, Play, Square, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Failure } from '@/components/failure.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { useApi, type ListenData } from '@/lib/api.ts'
import { cn } from '@/lib/utils.ts'
import { runColor } from './figures.ts'
import { usePlayer, type Player, type TakeRef } from './player.ts'
import { SentenceCard } from './sentence-card.tsx'
import { StripChart } from './strip-chart.tsx'
import { SummaryTable } from './summary-table.tsx'

const LEGEND = 'Same voice: the mean similarity of the speaker embeddings (3D-Speaker ERes2NetV2) of every pair of sentences with 1.5 s of voice or more; one real speaker is 0.84, and 0.33 against other men, Qwen3-TTS\'s ono_anna 0.76, and Irodori-TTS without a voice description, whose voice changes between sentences, 0.47 to 0.57. Pitch spread: the standard deviation of the sentences\' median pitch in semitones; ono_anna 1.5 to 1.8, a changing voice 3.6 to 6.6. Broken: sentences heard with more than 30% of their characters wrong.'

/** The runs a viewer marked as liked, kept in this browser for each set and for named and blind pages apart. */
function useStars(data: ListenData | null): [ReadonlySet<number>, (run: number) => void] {
  const keyOf = (run: number): string => (data ? `speech-bench-listen:${data.title}:${data.blind ? 'blind' : 'named'}:${data.runs[run]!.name}` : '')
  const read = (): Set<number> => {
    if (!data) return new Set()
    try {
      return new Set(data.runs.flatMap((_, run) => (localStorage.getItem(keyOf(run)) === '1' ? [run] : [])))
    } catch {
      return new Set()
    }
  }
  const [stars, setStars] = useState<{ data: ListenData | null; runs: Set<number> }>({ data, runs: read() })
  const current = stars.data === data ? stars.runs : read()
  const toggle = (run: number): void => {
    const next = new Set(current)
    if (next.has(run)) next.delete(run)
    else next.add(run)
    try {
      if (next.has(run)) localStorage.setItem(keyOf(run), '1')
      else localStorage.removeItem(keyOf(run))
    } catch {
      // A browser that keeps no storage still marks the runs until the page is left.
    }
    setStars({ data, runs: next })
  }
  return [current, toggle]
}

const everyTakeOf = (data: ListenData, run: number): TakeRef[] => data.sentences.map((_, sentence) => ({ sentence, run }))

function NowPlaying({ data, player }: { data: ListenData; player: Player }) {
  if (player.error) return <span className="text-sm text-destructive">{player.error}</span>
  if (!player.current) return <span className="text-sm text-muted-foreground">Play a voice's sentences in a row to hear whether it stays the same voice, or one sentence in every voice to compare them. Esc stops.</span>
  const { sentence, run } = player.current
  const take = data.sentences[sentence]!.takes[run]
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-sm" style={runColor(run)}>
      <span className="size-2.5 shrink-0 rounded-full bg-(--run)" />
      <span className="truncate">
        <span className="font-medium">{data.runs[run]!.name}</span> · {data.sentences[sentence]!.text}
        {take?.transcript !== undefined && <span className="text-muted-foreground"> — heard: {take.transcript}</span>}
      </span>
      <Button variant="outline" size="sm" className="ml-auto" onClick={player.stop}><Square />Stop</Button>
    </div>
  )
}

const OWN = 'own'

/** Which reference voice the runs are compared with: each with the one it spoke like, or all with one. */
function ReferencePicker({ value, onChange }: { value: string | null; onChange: (reference: string | null) => void }) {
  const references = useApi<string[]>('/api/references')
  return (
    <Select value={value ?? OWN} onValueChange={(chosen) => onChange(chosen === OWN ? null : chosen)}>
      <SelectTrigger size="sm" className="w-64" aria-label="Reference voice to compare with"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={OWN}>Each run's own reference</SelectItem>
        {references.state === 'loaded' && references.data.map((name) => <SelectItem key={name} value={name}>Like {name}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function Listening({ data, blind, onBlind, onReference }: { data: ListenData; blind: boolean; onBlind: (blind: boolean) => void; onReference: (reference: string | null) => void }) {
  const player = usePlayer(data)
  const [stars, toggleStar] = useStars(data)
  const header = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = header.current
    if (!element) return
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty('--sticky-height', `${element.offsetHeight}px`))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const facts = [data.shared, `${data.runs.length} voices, ${data.sentences.length} sentences`, data.blind ? 'names hidden and order shuffled' : ''].filter(Boolean).join(' · ')
  return (
    <>
      <div ref={header} className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-7xl space-y-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="icon-sm" asChild><Link to="/" aria-label="Back to the runs"><ArrowLeft /></Link></Button>
            <div className="min-w-0 flex-1">
              <h1 className="font-semibold">{data.title}</h1>
              <p className="truncate text-xs text-muted-foreground">{facts}</p>
            </div>
            {!data.blind && <ReferencePicker value={data.reference} onChange={onReference} />}
            <div className="flex items-center gap-2">
              <Switch id="blind" checked={blind} onCheckedChange={onBlind} />
              <Label htmlFor="blind">Blind</Label>
            </div>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {data.runs.map((run, index) => (
              <div
                key={index}
                style={runColor(index)}
                title={run.instruction ?? run.name}
                className={cn('flex shrink-0 items-center gap-1 rounded-lg border border-l-4 border-l-(--run) py-0.5 pr-1 pl-2.5 text-sm whitespace-nowrap', stars.has(index) && 'border-amber-500 bg-amber-500/10')}
              >
                <span className="mr-1 font-medium">{run.name}</span>
                <Button size="icon-xs" className="bg-(--run) text-white hover:bg-(--run)/85 dark:text-black" aria-label={`Play every sentence as ${run.name} spoke it`} onClick={() => player.play(everyTakeOf(data, index))}><Play /></Button>
                <Button variant="ghost" size="icon-xs" aria-label="Mark the voices you like" onClick={() => toggleStar(index)}>
                  <Star className={cn(stars.has(index) && 'fill-amber-500 text-amber-500')} />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex min-h-8 items-center"><NowPlaying data={data} player={player} /></div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-4 pb-16">
        {!data.blind && (
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
              <CardDescription>Click a column to sort. Green passes, red fails.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <SummaryTable data={data} starred={stars} onPlayRun={(run) => player.play(everyTakeOf(data, run))} />
              <p className="text-xs text-muted-foreground">{LEGEND}</p>
              <div className="grid gap-6 lg:grid-cols-2">
                <StripChart data={data} title="Pitch of each sentence" valueOf={(take) => take.pitchHz} format={(hz) => `${Math.round(hz)} Hz`} domain={[70, 400]} ticks={[100, 150, 200, 300]} scale="log" onPlay={(take) => player.play([take])} />
                <StripChart data={data} title="How much each sentence sounds like the rest" valueOf={(take) => take.likeness} format={(value) => value.toFixed(2)} domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} onPlay={(take) => player.play([take])} />
              </div>
            </CardContent>
          </Card>
        )}
        {data.sentences.map((sentence, index) => <SentenceCard key={sentence.id} data={data} sentence={sentence} index={index} player={player} />)}
        {data.key && (
          <Card>
            <CardContent>
              <details>
                <summary className="cursor-pointer text-sm font-medium">Which voice is which</summary>
                <ul className="mt-2 list-disc pl-5 text-sm">{data.key.map((line) => <li key={line}>{line}</li>)}</ul>
              </details>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  )
}

/** Every sentence as each chosen run spoke it, with the runs' figures, or blind with their names hidden. */
export function ListenPage() {
  const [params, setParams] = useSearchParams()
  const blind = params.get('blind') === '1'
  const listening = useApi<ListenData>(`/api/listen?${params.toString()}`)
  const change = (name: string, value: string | null): void => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(name)
    else next.set(name, value)
    setParams(next, { replace: true })
  }
  if (listening.state === 'failed') return <main className="mx-auto max-w-7xl px-4 py-6"><Failure error={listening.error} /></main>
  if (listening.state === 'loading') {
    return (
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <p className="text-sm text-muted-foreground">Reading the runs and comparing their voices; the first time a run is opened its sentences are analyzed, which takes a while.</p>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </main>
    )
  }
  return <Listening data={listening.data} blind={blind} onBlind={(on) => change('blind', on ? '1' : null)} onReference={(reference) => change('reference', reference)} />
}
