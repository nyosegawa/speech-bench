import { Play, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Failure } from '@/components/failure.tsx'
import { usePlayer, type Player } from '@/components/player.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import { Slider } from '@/components/ui/slider.tsx'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx'
import { useApi, type NeighborsData } from '@/lib/api.ts'
import { verdictClass } from '@/lib/figures.ts'
import { cn } from '@/lib/utils.ts'
import { HeatCanvas } from './heat-canvas.tsx'

type Group = NeighborsData[number]

function TakeRow({ group, take, selected, value, player, onSelect }: { group: Group; take: number; selected: number; value?: number; player: Player<number>; onSelect: (take: number) => void }) {
  const entry = group.takes[take]!
  const sameSentence = take !== selected && entry.sentence === group.takes[selected]!.sentence
  return (
    <div className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm', player.current === take && 'bg-muted')}>
      <Button variant="ghost" size="icon-xs" aria-label="Play this take" onClick={() => player.play([take])}><Play /></Button>
      <button type="button" className="min-w-0 flex-1 text-left" title="Select this take" onClick={() => onSelect(take)}>
        <div className="truncate text-xs font-medium">{entry.label}{sameSentence && ' · same sentence'}</div>
        <div className="truncate text-xs text-muted-foreground">{entry.text}</div>
      </button>
      {value !== undefined && (
        <div className="w-20 shrink-0 text-right text-xs tabular-nums">
          {value.toFixed(2)}
          <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${Math.max(0, value) * 100}%` }} /></span>
        </div>
      )}
      {value !== undefined && take !== selected && <Button variant="outline" size="xs" onClick={() => player.play([selected, take])}><Play />Both</Button>}
    </div>
  )
}

function GroupView({ group }: { group: Group }) {
  const player = usePlayer<number>((take) => group.takes[take]!.url)
  const [mode, setMode] = useState<'pairs' | 'center'>('pairs')
  const [threshold, setThreshold] = useState(0.8)
  const set = group.sets[mode][threshold.toFixed(2)]!
  const [selected, setSelected] = useState(set.members[0]!)
  const { stop } = player
  useEffect(() => stop, [group, stop])
  const others = group.similarity[selected]!.map((value, other) => ({ value, other })).filter(({ other }) => other !== selected).sort((a, b) => b.value - a.value)
  const seconds = set.members.reduce((sum, member) => sum + group.takes[member]!.seconds, 0)
  const labels = group.takes.map((take) => take.label)
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{[group.detail, group.tooShort > 0 ? `${group.tooShort} takes with less than 1.5 s of voice left out` : ''].filter(Boolean).join(' · ')}</p>
      <div className="flex min-h-9 items-center gap-2 text-sm">
        {player.current === null
          ? <span className="text-muted-foreground">Click a cell to hear its two takes one after the other, or a take to see its nearest and farthest. Esc stops.</span>
          : <><span className="truncate">{group.takes[player.current]!.label} · {group.takes[player.current]!.text}</span><Button variant="outline" size="sm" className="ml-auto" onClick={player.stop}><Square />Stop</Button></>}
      </div>
      <div className="grid gap-4 xl:grid-cols-[auto_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>How alike every pair is</CardTitle>
            <CardDescription>Takes that sound alike are ordered next to each other, so one voice shows as a dark block along the diagonal.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <HeatCanvas similarity={group.similarity} labels={labels} selected={selected} onCell={(row, column) => {
              setSelected(row)
              player.play(row === column ? [row] : [row, column])
            }} />
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>The largest set that holds together</CardTitle>
              <CardDescription>The largest set of takes around one center, one take of each sentence, since one voice rates a sentence it says twice about 0.07 more alike than two different sentences (Qwen3-TTS's ono_anna). Listen to them in a row to hear whether they are one voice.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Select value={mode} onValueChange={(value) => setMode(value as 'pairs' | 'center')}>
                  <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pairs">Every pair at least</SelectItem>
                    <SelectItem value="center">Each take, to the center, at least</SelectItem>
                  </SelectContent>
                </Select>
                <Slider className="w-56" min={0.5} max={0.95} step={0.01} value={[threshold]} onValueChange={([value]) => setThreshold(value!)} aria-label="Threshold" />
                <span className="text-sm font-medium tabular-nums">{threshold.toFixed(2)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-md bg-muted px-2 py-0.5 tabular-nums">{set.members.length} of {group.takes.length} takes, {seconds.toFixed(0)} s</span>
                <span className={cn('rounded-md px-2 py-0.5 tabular-nums', verdictClass[set.weakest >= threshold ? 'good' : 'bad'])} title="The least alike two takes of the set; below the threshold, the set is held together only through its center">weakest pair {set.weakest.toFixed(2)}</span>
                <Button size="sm" onClick={() => player.play(set.members)}><Play />Play the set</Button>
              </div>
              <div>{set.members.map((member) => <TakeRow key={member} group={group} take={member} selected={selected} value={group.similarity[set.members[0]!]![member]!} player={player} onSelect={setSelected} />)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Selected take</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <TakeRow group={group} take={selected} selected={selected} player={player} onSelect={setSelected} />
              <div className="text-xs font-medium text-muted-foreground">Nearest</div>
              <div>{others.slice(0, 6).map(({ value, other }) => <TakeRow key={other} group={group} take={other} selected={selected} value={value} player={player} onSelect={setSelected} />)}</div>
              <div className="text-xs font-medium text-muted-foreground">Farthest</div>
              <div>{others.slice(-3).reverse().map(({ value, other }) => <TakeRow key={other} group={group} take={other} selected={selected} value={value} player={player} onSelect={setSelected} />)}</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** The takes of chosen runs grouped by the voice they were meant to be, and how alike every two of them are. */
export function NeighborsPage() {
  const [params] = useSearchParams()
  const groups = useApi<NeighborsData>(`/api/neighbors?runs=${params.get('runs') ?? ''}`)
  const [group, setGroup] = useState(0)
  return (
    <main className="mx-auto max-w-screen-2xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold">Speaker neighbors</h1>
        <p className="text-sm text-muted-foreground">Synthesized sentences meant to be one voice, compared by speaker embeddings (3D-Speaker ERes2NetV2). One real speaker's recordings are 0.84 alike on average, and 0.33 like other men's.</p>
      </div>
      {groups.state === 'failed' && <Failure error={groups.error} />}
      {groups.state === 'loading' && <Skeleton className="h-96 w-full" />}
      {groups.state === 'loaded' && (
        <>
          {groups.data.length > 1 && (
            <Tabs value={String(group)} onValueChange={(value) => setGroup(Number(value))}>
              <TabsList className="h-auto flex-wrap">
                {groups.data.map((entry, index) => <TabsTrigger key={entry.name} value={String(index)}>{entry.name} ({entry.takes.length})</TabsTrigger>)}
              </TabsList>
            </Tabs>
          )}
          <GroupView key={group} group={groups.data[group]!} />
        </>
      )}
    </main>
  )
}
