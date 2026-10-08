import { FileText, Grid3x3, Headphones, Search, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { compareValues, SortHeader, type Sort } from '@/components/sort-header.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Failure } from '@/components/failure.tsx'
import { Card, CardContent } from '@/components/ui/card.tsx'
import { Checkbox } from '@/components/ui/checkbox.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { useApi, type CampaignRow, type RunRow } from '@/lib/api.ts'
import { isTts, machineOf, percent, preparationOf, seconds, voiceOf, when, type AsrRow, type TtsRow } from '@/lib/format.ts'

interface Column<R> {
  key: string
  label: string
  hint?: string
  numeric?: boolean
  firstDescending?: boolean
  value: (row: R) => number | string
  cell: (row: R) => ReactNode
}

const runtimeOf = (row: RunRow): string => {
  const { id, version, build } = row.run.runtime
  return `${id} ${version}${build === null ? '' : `, ${build.ciRun === null ? 'local' : 'CI'} build ${build.commit.slice(0, 12)}`}`
}

const optionsOf = (row: RunRow): string => Object.entries(row.run.runtime.options).map(([name, value]) => `${name}=${value}`).join(', ')

function ModelCell({ row }: { row: RunRow }) {
  const options = optionsOf(row)
  return (
    <div className="min-w-48">
      <div className="font-medium">{row.run.model.label}</div>
      <div className="text-xs text-muted-foreground" title={options}>{runtimeOf(row)}{options && ' · options'}</div>
    </div>
  )
}

function MachineCell({ row }: { row: RunRow }) {
  return (
    <div className="min-w-36">
      <div>{row.run.machine.gpus.join(' + ')}</div>
      <div className="text-xs text-muted-foreground">{row.run.machine.hostname}</div>
    </div>
  )
}

const common = {
  started: { key: 'started', label: 'Started', firstDescending: true, value: (row: RunRow) => row.run.startedAt, cell: (row: RunRow) => <span className="whitespace-nowrap tabular-nums">{when(row.run.startedAt)}</span> },
  model: { key: 'model', label: 'Model', value: (row: RunRow) => `${row.run.model.label} ${runtimeOf(row)}`, cell: (row: RunRow) => <ModelCell row={row} /> },
  set: { key: 'set', label: 'Set', value: (row: RunRow) => row.run.set.name, cell: (row: RunRow) => <span className="whitespace-nowrap">{row.run.set.name}</span> },
  machine: { key: 'machine', label: 'Machine', value: machineOf, cell: (row: RunRow) => <MachineCell row={row} /> }
}

const number = (text: string): ReactNode => <span className="tabular-nums whitespace-nowrap">{text}</span>

const TTS_COLUMNS: Array<Column<TtsRow>> = [
  common.started,
  common.model,
  { key: 'voice', label: 'Voice', value: voiceOf, cell: (row) => <span className="block min-w-40">{voiceOf(row) || <span className="text-muted-foreground">model's own</span>}</span> },
  common.set,
  common.machine,
  { key: 'cer', label: 'Heard CER', numeric: true, hint: 'What the recognizer misheard in the speech, each sentence counting at most all of its characters.', value: (row) => row.errorRate, cell: (row) => number(percent(row.errorRate)) },
  { key: 'said', label: 'Heard as said', numeric: true, firstDescending: true, hint: 'Sentences the recognizer heard as they were written, apart from how it spells them.', value: (row) => row.heardAsSaid / row.sentences, cell: (row) => number(`${row.heardAsSaid} / ${row.sentences}`) },
  { key: 'first', label: 'First audio', numeric: true, hint: 'Seconds from asking for a sentence to its first audio: median, and the 90th percentile below.', value: (row) => row.medianFirstAudioSeconds, cell: (row) => <div className="tabular-nums whitespace-nowrap">{seconds(row.medianFirstAudioSeconds)}<div className="text-xs text-muted-foreground">p90 {seconds(row.p90FirstAudioSeconds)}</div></div> },
  { key: 'rtf', label: 'RTF', numeric: true, hint: 'Synthesis time over the duration of the speech.', value: (row) => row.realTimeFactor, cell: (row) => number(row.realTimeFactor.toFixed(2)) },
  { key: 'pace', label: 's / char', numeric: true, hint: 'Seconds of speech per character of text, which shows speech that runs on or rushes.', value: (row) => row.secondsPerCharacter, cell: (row) => number(row.secondsPerCharacter.toFixed(3)) }
]

const ASR_COLUMNS: Array<Column<AsrRow>> = [
  common.started,
  common.model,
  { key: 'audio', label: 'Audio', value: preparationOf, cell: (row) => <span className="block min-w-40">{preparationOf(row)}</span> },
  common.set,
  common.machine,
  { key: 'cer', label: 'CER', numeric: true, hint: 'Errors over the utterances heard divided by their reference length.', value: (row) => row.errorRate, cell: (row) => number(percent(row.errorRate)) },
  {
    key: 'accepted',
    label: 'Accepted CER',
    numeric: true,
    hint: 'The CER when a transcription may write the reference in the readings and other spellings its sentence is annotated with; given once every utterance heard is annotated.',
    value: (row) => row.acceptedErrorRate ?? Number.POSITIVE_INFINITY,
    cell: (row) => row.acceptedErrorRate !== null
      ? number(percent(row.acceptedErrorRate))
      : <span className="tabular-nums whitespace-nowrap text-muted-foreground" title="utterances heard whose sentence is annotated">{row.annotated === 0 ? '—' : `${row.annotated} / ${row.utterances - row.dropped}`}</span>
  },
  { key: 'dropped', label: 'Dropped', numeric: true, hint: 'Utterances in which the VAD found no voice; the other figures leave them out.', value: (row) => row.dropped, cell: (row) => number(`${row.dropped} / ${row.utterances}`) },
  { key: 'empty', label: 'Empty', numeric: true, hint: 'Utterances the model heard nothing in.', value: (row) => row.empty, cell: (row) => number(String(row.empty)) },
  { key: 'time', label: 'Time', numeric: true, hint: 'Seconds to transcribe an utterance: median, and the 90th percentile below.', value: (row) => row.medianSeconds, cell: (row) => <div className="tabular-nums whitespace-nowrap">{seconds(row.medianSeconds)}<div className="text-xs text-muted-foreground">p90 {seconds(row.p90Seconds)}</div></div> },
  { key: 'rtf', label: 'RTF', numeric: true, hint: 'Transcription time over the duration of the audio.', value: (row) => row.realTimeFactor, cell: (row) => number(row.realTimeFactor.toFixed(3)) }
]

const ALL = 'all'

type Task = RunRow['run']['task']

const matches = (row: RunRow, words: readonly string[]): boolean => {
  const text = [row.id, row.run.model.id, row.run.model.label, runtimeOf(row), optionsOf(row), machineOf(row), row.run.set.name, ...row.campaigns, isTts(row) ? voiceOf(row) : preparationOf(row)].join(' ').toLowerCase()
  return words.every((word) => text.includes(word))
}

export function RunsPage() {
  const runs = useApi<RunRow[]>('/api/runs')
  const campaigns = useApi<CampaignRow[]>('/api/campaigns')
  const [params, setParams] = useSearchParams()
  const set = params.get('set') ?? ALL
  const campaign = params.get('campaign') ?? ALL
  const query = params.get('q') ?? ''
  const [sort, setSort] = useState<Sort>({ key: 'started', descending: true })
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const navigate = useNavigate()

  const update = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(params)
    for (const [name, value] of Object.entries(changes)) {
      if (value === null || value === ALL || value === '') next.delete(name)
      else next.set(name, value)
    }
    setParams(next, { replace: true })
  }

  const all = runs.state === 'loaded' ? runs.data : []
  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return all.filter((row) => (set === ALL || row.run.set.name === set) && (campaign === ALL || row.campaigns.includes(campaign)) && matches(row, words))
  }, [all, set, campaign, query])
  const matching = { tts: filtered.filter(isTts).length, asr: filtered.filter((row) => !isTts(row)).length }
  // A link that names a campaign or a set but no tab opens on the tab whose runs it names.
  const named = params.get('task')
  const task: Task = named === 'asr' || named === 'tts' ? named : matching.tts === 0 && matching.asr > 0 ? 'asr' : 'tts'
  const ofTask = useMemo(() => all.filter((row) => row.run.task === task), [all, task])
  const sets = useMemo(() => [...new Set(ofTask.map((row) => row.run.set.name))].sort(), [ofTask])
  const columns = (task === 'tts' ? TTS_COLUMNS : ASR_COLUMNS) as Array<Column<RunRow>>
  const shown = useMemo(() => {
    const column = columns.find((candidate) => candidate.key === sort.key) ?? columns[0]!
    return filtered.filter((row) => row.run.task === task).sort((a, b) => compareValues(column.value(a), column.value(b)) * (sort.descending ? -1 : 1))
  }, [filtered, task, sort, columns])

  const chosen = all.filter((row) => selected.has(row.id))
  const chosenIds = chosen.map((row) => row.id).join(',')
  const chosenSets = new Set(chosen.map((row) => row.run.set.name))
  const toggle = (id: string, on: boolean): void => setSelected((current) => {
    const next = new Set(current)
    if (on) next.add(id)
    else next.delete(id)
    return next
  })
  const everyShownChosen = shown.length > 0 && shown.every((row) => selected.has(row.id))

  return (
    <main className="mx-auto max-w-screen-2xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Runs</h1>
          <p className="text-sm text-muted-foreground">Every measurement in the data folder. Choose runs of one set to hear or read them side by side.</p>
        </div>
        <Tabs value={task} onValueChange={(value) => { setSelected(new Set()); update({ task: value, set: null }) }}>
          <TabsList>
            <TabsTrigger value="tts">Synthesis{runs.state === 'loaded' && <span className="text-muted-foreground tabular-nums">{matching.tts}</span>}</TabsTrigger>
            <TabsTrigger value="asr">Recognition{runs.state === 'loaded' && <span className="text-muted-foreground tabular-nums">{matching.asr}</span>}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Model, voice, machine, run…" value={query} onChange={(event) => update({ q: event.target.value })} />
        </div>
        <Select value={set} onValueChange={(value) => update({ set: value })}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Every set</SelectItem>
            {sets.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={campaign} onValueChange={(value) => update({ campaign: value })}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Every campaign</SelectItem>
            {campaigns.state === 'loaded' && campaigns.data.map((entry) => <SelectItem key={entry.name} value={entry.name}>{entry.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{runs.state === 'loaded' && `${shown.length} of ${ofTask.length} runs`}</span>
      </div>

      <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
        <span className="text-sm text-muted-foreground">{chosen.length === 0 ? (task === 'tts' ? 'Choose runs to listen to.' : 'Choose runs to read their transcripts side by side.') : `${chosen.length} chosen`}</span>
        {chosenSets.size > 1 && <span className="text-sm text-destructive">Choose runs of one set: these are of {[...chosenSets].join(', ')}.</span>}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" disabled={chosen.length === 0} onClick={() => setSelected(new Set())}><X />Clear</Button>
          {task === 'tts' && <Button variant="outline" size="sm" disabled={chosen.length === 0} onClick={() => navigate(`/neighbors?runs=${chosenIds}`)}><Grid3x3 />Neighbors</Button>}
          {task === 'tts' && <Button size="sm" disabled={chosen.length === 0 || chosenSets.size > 1} onClick={() => navigate(`/listen?runs=${chosenIds}`)}><Headphones />Listen</Button>}
          {task === 'asr' && <Button size="sm" disabled={chosen.length === 0 || chosenSets.size > 1} onClick={() => navigate(`/transcripts?runs=${chosenIds}`)}><FileText />Transcripts</Button>}
        </div>
      </div>

      {runs.state === 'failed' && <Failure error={runs.error} />}
      {runs.state !== 'failed' && (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      aria-label="Choose every run shown"
                      checked={everyShownChosen}
                      onCheckedChange={(on) => setSelected((current) => {
                        const next = new Set(current)
                        for (const row of shown) {
                          if (on === true) next.add(row.id)
                          else next.delete(row.id)
                        }
                        return next
                      })}
                    />
                  </TableHead>
                  {columns.map((column) => (
                    <SortHeader key={column.key} column={column.key} sort={sort} onSort={setSort} numeric={column.numeric} firstDescending={column.firstDescending}>
                      {column.hint ? (
                        <Tooltip>
                          <TooltipTrigger asChild><span className="underline decoration-dotted underline-offset-4">{column.label}</span></TooltipTrigger>
                          <TooltipContent className="max-w-64">{column.hint}</TooltipContent>
                        </Tooltip>
                      ) : column.label}
                    </SortHeader>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.state === 'loading' && Array.from({ length: 8 }, (_, index) => (
                  <TableRow key={index}><TableCell colSpan={columns.length + 1}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                ))}
                {shown.map((row) => (
                  <TableRow key={row.id} data-state={selected.has(row.id) ? 'selected' : undefined}>
                    <TableCell className="pl-4">
                      <Checkbox aria-label={`Choose ${row.id}`} checked={selected.has(row.id)} onCheckedChange={(on) => toggle(row.id, on === true)} />
                    </TableCell>
                    {columns.map((column) => (
                      <TableCell key={column.key} className={column.numeric ? 'text-right' : undefined}>
                        {column.cell(row)}
                        {column.key === 'set' && row.campaigns.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">{row.campaigns.map((name) => <Badge key={name} variant="secondary">{name}</Badge>)}</div>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {runs.state === 'loaded' && shown.length === 0 && (
                  <TableRow><TableCell colSpan={columns.length + 1} className="py-10 text-center text-muted-foreground">No run matches.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
