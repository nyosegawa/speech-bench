import { Play } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { compareValues, SortHeader, type Sort } from '@/components/sort-header.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx'
import type { ListenData } from '@/lib/api.ts'
import { percent, seconds } from '@/lib/format.ts'
import { cn } from '@/lib/utils.ts'
import { brokenIn, judge, LIMITS, runColor, verdictClass, type ListenedRun, type Verdict } from './figures.ts'

interface Column {
  key: string
  label: string
  higherIsBetter: boolean
  value: (run: ListenedRun, index: number) => number
  text: (run: ListenedRun, index: number) => string
  verdict: (run: ListenedRun, index: number) => Verdict
  /** Where the figure lies on a bar from 0 to 1, for the figures with a scale. */
  share?: (run: ListenedRun) => number
}

/** A run's figures, which the summary shows only when the page names the runs. */
const figuresOf = (run: ListenedRun) => {
  if (run.heardErrorRate === undefined) throw new Error('a blind page has no figures to summarize')
  return run as Required<ListenedRun>
}

function columnsOf(data: ListenData): Column[] {
  const hasReference = data.runs.some((run) => run.likeReference !== null && run.likeReference !== undefined)
  return [
    { key: 'same', label: 'Same voice', higherIsBetter: true, value: (run) => figuresOf(run).sameVoice, text: (run) => figuresOf(run).sameVoice.toFixed(2), verdict: (run) => judge(figuresOf(run).sameVoice, LIMITS.sameGood, LIMITS.sameBad, true), share: (run) => figuresOf(run).sameVoice },
    ...(hasReference
      ? [{
          key: 'reference', label: data.reference ? `Like ${data.reference}` : 'Like its reference', higherIsBetter: true,
          value: (run: ListenedRun) => run.likeReference ?? 0,
          text: (run: ListenedRun) => (run.likeReference === null || run.likeReference === undefined ? '–' : run.likeReference.toFixed(2)),
          verdict: (run: ListenedRun) => (run.likeReference === null || run.likeReference === undefined ? null : judge(run.likeReference, LIMITS.sameGood, LIMITS.sameBad, true)),
          share: (run: ListenedRun) => run.likeReference ?? 0
        }]
      : []),
    { key: 'spread', label: 'Pitch spread', higherIsBetter: false, value: (run) => figuresOf(run).pitchSpread, text: (run) => `${figuresOf(run).pitchSpread.toFixed(1)} st`, verdict: (run) => judge(figuresOf(run).pitchSpread, LIMITS.spreadGood, LIMITS.spreadBad, false), share: (run) => figuresOf(run).pitchSpread / 6 },
    { key: 'pitch', label: 'Pitch', higherIsBetter: true, value: (run) => run.pitchHz ?? 0, text: (run) => (run.pitchHz ? `${Math.round(run.pitchHz)} Hz` : '–'), verdict: () => null },
    { key: 'cer', label: 'Heard CER', higherIsBetter: false, value: (run) => figuresOf(run).heardErrorRate, text: (run) => percent(figuresOf(run).heardErrorRate), verdict: (run) => judge(figuresOf(run).heardErrorRate, LIMITS.cerGood, LIMITS.cerBad, false) },
    { key: 'broken', label: 'Broken', higherIsBetter: false, value: (_, index) => brokenIn(data, index), text: (_, index) => String(brokenIn(data, index)), verdict: (_, index) => (brokenIn(data, index) === 0 ? 'good' : 'bad') },
    { key: 'first', label: 'First audio', higherIsBetter: false, value: (run) => figuresOf(run).medianFirstAudioSeconds, text: (run) => seconds(figuresOf(run).medianFirstAudioSeconds), verdict: () => null }
  ]
}

function Figure({ text, verdict, share }: { text: string; verdict: Verdict; share?: number }): ReactNode {
  return (
    <TableCell className={cn('text-right tabular-nums whitespace-nowrap', verdict && verdictClass[verdict])}>
      {text}
      {share !== undefined && (
        <span className="mt-1 block h-1 min-w-16 overflow-hidden rounded-full bg-muted">
          <span className="block h-full bg-current" style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }} />
        </span>
      )}
    </TableCell>
  )
}

/** The runs' figures side by side, green where a figure passes its limit and red where it fails. */
export function SummaryTable({ data, starred, onPlayRun }: { data: ListenData; starred: ReadonlySet<number>; onPlayRun: (run: number) => void }) {
  const [sort, setSort] = useState<Sort>({ key: 'voice', descending: false })
  const columns = columnsOf(data)
  const column = columns.find((candidate) => candidate.key === sort.key)
  const order = data.runs.map((_, index) => index).sort((a, b) => {
    const compared = column ? compareValues(column.value(data.runs[a]!, a), column.value(data.runs[b]!, b)) : a - b
    return compared * (sort.descending ? -1 : 1)
  })
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHeader column="voice" sort={sort} onSort={setSort}>Voice</SortHeader>
          {columns.map((entry) => (
            <SortHeader key={entry.key} column={entry.key} sort={sort} onSort={setSort} numeric firstDescending={entry.higherIsBetter}>{entry.label}</SortHeader>
          ))}
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {order.map((index) => {
          const run = data.runs[index]!
          return (
            <TableRow key={index} style={runColor(index)}>
              <TableCell className="max-w-96 min-w-56 border-l-4 border-l-(--run) whitespace-normal">
                <div className="font-medium">{starred.has(index) && '★ '}{run.name}</div>
                {run.instruction && <div className="text-xs text-muted-foreground">{run.instruction}</div>}
              </TableCell>
              {columns.map((entry) => <Figure key={entry.key} text={entry.text(run, index)} verdict={entry.verdict(run, index)} share={entry.share?.(run)} />)}
              <TableCell>
                <Button variant="outline" size="sm" onClick={() => onPlayRun(index)}><Play />All</Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
