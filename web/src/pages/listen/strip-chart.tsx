import { CartesianGrid, Scatter, ScatterChart, Tooltip, XAxis, YAxis, type YAxisTickContentProps } from 'recharts'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart.tsx'
import type { ListenData } from '@/lib/api.ts'
import type { Take } from './listen-data.ts'
import type { TakeRef } from './listen-data.ts'

interface Point {
  value: number
  name: string
  sentence: number
  run: number
  text: string
}

const LABEL_WIDTH = 170

/** A run's name beside its row, in its color and cut to the width, with the whole name on hover. */
function RunTick({ x, y, name, data }: { x: number | string; y: number | string; name: string; data: ListenData }) {
  const run = data.runs.findIndex((candidate) => candidate.name === name)
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fontWeight={600} fill={`var(--run-${run % 10})`}>
      <title>{name}</title>
      {name.length > 26 ? `${name.slice(0, 25)}…` : name}
    </text>
  )
}

/** One row per run with a point per sentence, so that a voice that holds shows as a tight cluster. */
export function StripChart({ data, title, valueOf, format, domain, ticks, scale = 'linear', onPlay }: {
  data: ListenData
  title: string
  valueOf: (take: Take) => number | null | undefined
  format: (value: number) => string
  domain: [number, number]
  ticks: number[]
  scale?: 'linear' | 'log'
  onPlay: (take: TakeRef) => void
}) {
  const config: ChartConfig = Object.fromEntries(data.runs.map((run, index) => [`run${index}`, { label: run.name, color: `var(--run-${index % 10})` }]))
  const series = data.runs.map((run, index) => data.sentences.flatMap((sentence, which): Point[] => {
    const take = sentence.takes[index]
    const value = take ? valueOf(take) : null
    return value === null || value === undefined ? [] : [{ value: Math.min(domain[1], Math.max(domain[0], value)), name: run.name, sentence: which, run: index, text: sentence.text }]
  }))
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-sm font-medium">{title}</figcaption>
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height: data.runs.length * 30 + 40 }}>
        <ScatterChart margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" dataKey="value" domain={domain} ticks={ticks} scale={scale} tickFormatter={format} allowDataOverflow />
          <YAxis type="category" dataKey="name" reversed width={LABEL_WIDTH} allowDuplicatedCategory={false} interval={0} tick={(props: YAxisTickContentProps) => <RunTick x={props.x} y={props.y} name={String(props.payload.value)} data={data} />} />
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as Point | undefined
              if (!active || !point) return null
              return (
                <div className="max-w-72 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow">
                  <div className="font-medium">{point.name} · {format(point.value)}</div>
                  <div className="text-muted-foreground">{point.text}</div>
                </div>
              )
            }}
          />
          {series.map((points, index) => (
            <Scatter
              key={index}
              data={points}
              fill={`var(--color-run${index})`}
              fillOpacity={0.8}
              isAnimationActive={false}
              className="cursor-pointer"
              onClick={(entry) => {
                const point = (entry as { payload?: Point }).payload
                if (point) onPlay({ sentence: point.sentence, run: point.run })
              }}
            />
          ))}
        </ScatterChart>
      </ChartContainer>
    </figure>
  )
}
