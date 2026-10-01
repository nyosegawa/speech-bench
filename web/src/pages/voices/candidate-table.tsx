import type { ReactNode } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx'
import { judge, LIMITS, runColor, verdictClass, type Verdict } from '@/lib/figures.ts'
import { percent } from '@/lib/format.ts'
import { cn } from '@/lib/utils.ts'
import type { VoicesData } from './voice-clips.tsx'

function Figure({ text, verdict }: { text: string; verdict: Verdict }) {
  return <TableCell className={cn('text-right tabular-nums', verdict && verdictClass[verdict])}>{text}</TableCell>
}

const fixed = (value: number | null): string => (value === null ? '–' : value.toFixed(2))

/**
 * Candidates' figures over every sentence of every run that spoke like them, a row each, with what the page
 * puts before and after the figures.
 */
export function CandidateTable({ data, rows, colorOf, name, extraHeads = [], extra = () => null, actions }: {
  data: VoicesData
  rows: readonly number[]
  colorOf: (candidate: number) => number
  name: (candidate: number) => ReactNode
  extraHeads?: string[]
  extra?: (candidate: number) => ReactNode
  actions: (candidate: number) => ReactNode
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Voice</TableHead>
          <TableHead className="text-right">Same voice</TableHead>
          <TableHead className="text-right">Like its reference</TableHead>
          <TableHead className="text-right">Heard CER</TableHead>
          <TableHead className="text-right">Broken</TableHead>
          <TableHead className="text-right">Pitch</TableHead>
          {extraHeads.map((head) => <TableHead key={head}>{head}</TableHead>)}
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((candidate) => {
          const figures = data.candidates[candidate]!
          return (
            <TableRow key={candidate} style={runColor(colorOf(candidate))}>
              <TableCell className="border-l-4 border-l-(--run) whitespace-normal">{name(candidate)}</TableCell>
              <Figure text={fixed(figures.sameVoice)} verdict={figures.sameVoice === null ? null : judge(figures.sameVoice, LIMITS.sameGood, LIMITS.sameBad, true)} />
              <Figure text={fixed(figures.likeReference)} verdict={figures.likeReference === null ? null : judge(figures.likeReference, LIMITS.sameGood, LIMITS.sameBad, true)} />
              <Figure text={percent(figures.heardErrorRate)} verdict={judge(figures.heardErrorRate, LIMITS.cerGood, LIMITS.cerBad, false)} />
              <Figure text={`${figures.broken} of ${figures.takes}`} verdict={figures.broken === 0 ? 'good' : 'bad'} />
              <Figure text={figures.pitchHz ? `${Math.round(figures.pitchHz)} Hz` : '–'} verdict={null} />
              {extra(candidate)}
              <TableCell><div className="flex justify-end gap-1">{actions(candidate)}</div></TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export const LEGEND = 'The figures are over every sentence of every run that spoke like the reference. Same voice: the mean similarity of the speaker embeddings (3D-Speaker ERes2NetV2) of every pair of its takes with 1.5 s of voice or more. Like its reference: the mean similarity of its takes to the reference it spoke like. Broken: takes heard with more than 30% of their characters wrong.'
