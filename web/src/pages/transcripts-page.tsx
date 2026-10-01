import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Failure } from '@/components/failure.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx'
import { useApi, type Transcripts } from '@/lib/api.ts'
import { runColor } from '@/lib/figures.ts'
import { percent } from '@/lib/format.ts'
import { cn } from '@/lib/utils.ts'

type Utterance = Transcripts['utterances'][number]
type Heard = NonNullable<Utterance['heard'][number]>
type Aligned = Extract<Heard, { alignment: unknown }>['alignment'][number]

const errorsOf = (heard: Heard | null): number => (heard && 'errors' in heard ? heard.errors : 0)

/** Whether the runs heard an utterance differently from each other, dropped ones included. */
const disagree = (utterance: Utterance): boolean => new Set(utterance.heard.map((heard) => (heard === null ? '' : 'text' in heard ? heard.alignment.map((step) => step.hypothesis ?? '').join('') : heard.droppedBy))).size > 1

const FILTERS = {
  all: { label: 'Every utterance', keep: () => true },
  errors: { label: 'Heard wrong by a run', keep: (utterance: Utterance) => utterance.heard.some((heard) => errorsOf(heard) > 0 || (heard !== null && 'droppedBy' in heard)) },
  disagree: { label: 'Heard differently by the runs', keep: disagree }
} as const

/** A transcription as it was scored, with what it got wrong marked against the reference. */
function AlignedText({ alignment, words }: { alignment: Aligned[]; words: boolean }) {
  return (
    <span className="leading-loose">
      {alignment.map((step, index) => {
        const space = words && index > 0 ? ' ' : ''
        if (step.reference === step.hypothesis) return <span key={index}>{space}{step.hypothesis}</span>
        if (step.hypothesis === null) return <span key={index}>{space}<del className="rounded-sm bg-red-500/10 px-0.5 text-red-700/70 dark:text-red-400/70" title="not heard">{step.reference}</del></span>
        if (step.reference === null) return <span key={index}>{space}<ins className="rounded-sm bg-amber-500/20 px-0.5 no-underline" title="heard, not said">{step.hypothesis}</ins></span>
        return <span key={index}>{space}<mark className="rounded-sm bg-red-500/20 px-0.5 text-inherit" title={`heard for ${step.reference}`}>{step.hypothesis}</mark></span>
      })}
    </span>
  )
}

/** Recognition runs of one set side by side: what each heard of every utterance, aligned with the reference. */
export function TranscriptsPage() {
  const [params] = useSearchParams()
  const data = useApi<Transcripts>(`/api/transcripts?runs=${params.get('runs') ?? ''}`)
  const [filter, setFilter] = useState<keyof typeof FILTERS>('errors')
  const [order, setOrder] = useState<'set' | 'errors'>('set')
  const shown = useMemo(() => {
    if (data.state !== 'loaded') return []
    const kept = data.data.utterances.filter(FILTERS[filter].keep)
    const total = (utterance: Utterance): number => utterance.heard.reduce((sum, heard) => sum + errorsOf(heard), 0)
    return order === 'errors' ? [...kept].sort((a, b) => total(b) - total(a)) : kept
  }, [data, filter, order])

  if (data.state === 'failed') return <main className="mx-auto max-w-screen-xl px-4 py-6"><Failure error={data.error} /></main>
  if (data.state === 'loading') return <main className="mx-auto max-w-screen-xl px-4 py-6"><Skeleton className="h-96 w-full" /></main>
  const { set, locale, shared, runs, utterances, byCharacter } = data.data
  const words = !byCharacter
  return (
    <main className="mx-auto max-w-screen-xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold">{set}</h1>
        <p className="text-sm text-muted-foreground">{[locale, shared, `${runs.length} runs, ${utterances.length} utterances`].filter(Boolean).join(' · ')}</p>
      </div>
      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Run</TableHead>
                <TableHead className="text-right">{words ? 'WER' : 'CER'}</TableHead>
                <TableHead className="text-right">Dropped</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run, index) => (
                <TableRow key={run.id} style={runColor(index)}>
                  <TableCell className="border-l-4 border-l-(--run) pl-4 font-medium whitespace-normal">{run.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{percent(run.errorRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{run.dropped} / {run.utterances}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filter} onValueChange={(value) => setFilter(value as keyof typeof FILTERS)}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(FILTERS).map(([key, entry]) => <SelectItem key={key} value={key}>{entry.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={order} onValueChange={(value) => setOrder(value as 'set' | 'errors')}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="set">In the set's order</SelectItem>
            <SelectItem value="errors">Most errors first</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{shown.length} of {utterances.length} utterances</span>
        <span className="ml-auto flex gap-3 text-xs text-muted-foreground">
          <mark className="rounded-sm bg-red-500/20 px-1 text-inherit">heard for another</mark>
          <ins className="rounded-sm bg-amber-500/20 px-1 no-underline">heard, not said</ins>
          <del className="rounded-sm bg-red-500/10 px-1">not heard</del>
        </span>
      </div>
      {shown.map((utterance) => (
        <Card key={utterance.id} className="gap-3">
          <CardHeader>
            <CardDescription className="font-mono text-xs">{utterance.id}</CardDescription>
            <CardTitle className="text-lg leading-relaxed font-normal">{utterance.reference}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {utterance.heard.map((heard, index) => (
              <div key={index} style={runColor(index)} className="grid grid-cols-[minmax(8rem,14rem)_4.5rem_1fr] items-baseline gap-3 border-l-4 border-l-(--run) pl-3 text-sm">
                <span className="truncate text-xs text-muted-foreground" title={runs[index]!.name}>{runs[index]!.name}</span>
                <span className={cn('text-right text-xs tabular-nums', errorsOf(heard) > 0 ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground')}>
                  {heard && 'errors' in heard ? `${heard.errors} / ${heard.referenceLength}` : ''}
                </span>
                {heard === null && <span className="text-muted-foreground">not in this run</span>}
                {heard && 'droppedBy' in heard && <span className="text-muted-foreground">dropped: {heard.droppedBy === 'no-voice' ? 'no voice found' : "ASIST's VAD kept nothing"}</span>}
                {heard && 'alignment' in heard && <AlignedText alignment={heard.alignment} words={words} />}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </main>
  )
}
