import { ArrowLeft, Check, Copy, Play } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Failure } from '@/components/failure.tsx'
import { PlayedBar, usePlayer, type Player } from '@/components/player.tsx'
import { SimilarityMatrix } from '@/components/similarity-matrix.tsx'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import { postJson, useApi, type ChooseAnswer, type VoiceDetail } from '@/lib/api.ts'
import { LIMITS, runColor } from '@/lib/figures.ts'
import { percent, seconds } from '@/lib/format.ts'
import { cn } from '@/lib/utils.ts'
import { CandidateTable, LEGEND } from './candidate-table.tsx'
import { NowPlaying, referenceClip, sentenceClips, takeClip, type Clip, type VoicesData } from './voice-clips.tsx'

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 font-mono text-xs">
      <code className="min-w-0 flex-1 truncate">{command}</code>
      <Button variant="ghost" size="icon-xs" aria-label="Copy the command" onClick={() => {
        void navigator.clipboard.writeText(command).then(() => setCopied(true))
      }}>{copied ? <Check /> : <Copy />}</Button>
    </div>
  )
}

/** The four steps of making the voice, how far each has gone, and the command that takes it. */
function Steps({ detail }: { detail: VoiceDetail }) {
  const { recipe, locale } = detail
  const tried = detail.trySets.reduce((sum, set) => sum + set.runs, 0)
  const steps = [
    { title: 'Gather takes', done: `${detail.gathered} runs of its description saying its lines`, command: `node src/cli.ts voice gather ${recipe.id} --locale ${locale}` },
    { title: 'Make candidates', done: `${detail.candidates.length} candidate references`, command: `node src/cli.ts voice candidates ${recipe.id} --locale ${locale}` },
    { title: 'Try them', done: `${tried} runs that spoke like a candidate`, command: `node src/cli.ts voice try ${recipe.id} --locale ${locale}` },
    { title: 'Choose', done: recipe.chosen ? `chose ${recipe.chosen.candidate}, kept as ${recipe.chosen.reference}` : 'not chosen yet; choose below', command: null }
  ]
  return (
    <Card>
      <CardHeader><CardTitle>Steps</CardTitle></CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {steps.map((step, index) => (
          <div key={step.title} className="space-y-1.5 rounded-lg border p-3">
            <div className="text-sm font-medium">{index + 1}. {step.title}</div>
            <div className="text-xs text-muted-foreground">{step.done}</div>
            {step.command && <CopyCommand command={step.command} />}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function ChooseButton({ detail, candidate, onChosen }: { detail: VoiceDetail; candidate: string; onChosen: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const { recipe, locale } = detail
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild><Button size="sm">Choose</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Choose {candidate} for {recipe.id}?</AlertDialogTitle>
          <AlertDialogDescription>
            The candidate is copied to the reference voice-{recipe.id}, and the choice is written into prompts/voices-{locale}.json.
            {recipe.chosen && ` ${recipe.chosen.reference} holds ${recipe.chosen.candidate} now and is not replaced with other audio; remove it from the references folder first.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={(event) => {
            event.preventDefault()
            postJson<ChooseAnswer>(`/api/voices/${recipe.id}/choose`, { locale, candidate }).then(onChosen, (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
          }}>Choose</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Each sentence the candidates were tried on, with a take of every candidate and run. */
function TrySentences({ data, player, colorOf }: { data: VoicesData; player: Player<Clip>; colorOf: (candidate: number) => number }) {
  return (
    <div className="space-y-3">
      {data.sentences.map((sentence, index) => (
        <Card key={sentence.id} className="gap-3">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{index + 1} of {data.sentences.length} · {sentence.kind} · {sentence.id}</span>
            <Button size="sm" onClick={() => player.play(data.candidates.flatMap((candidate, which) => takeClip(data, which, 0, index, candidate.name, colorOf(which)) ?? []))}><Play />Every candidate</Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-lg leading-relaxed">{sentence.text}</p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
              {sentence.takes.flatMap((runs, candidate) => runs.map((take, run) => {
                const clip = takeClip(data, candidate, run, index, data.candidates[candidate]!.name, colorOf(candidate))
                const playing = clip !== null && player.current?.key === clip.key
                return (
                  <button
                    key={`${candidate}-${run}`}
                    type="button"
                    disabled={!clip}
                    title={take ? `heard: ${take.transcript}` : undefined}
                    onClick={() => clip && player.play([clip])}
                    style={runColor(colorOf(candidate))}
                    className={cn('relative overflow-hidden rounded-lg border border-l-4 border-l-(--run) px-2.5 py-2 text-left text-sm hover:bg-muted/60 disabled:opacity-40', playing && 'border-(--run) bg-[color-mix(in_oklab,var(--run)_14%,transparent)]')}
                  >
                    <span className="flex items-center gap-1 font-medium"><Play className="size-3" />{candidate + 1} · {data.candidates[candidate]!.runs[run]}</span>
                    {take && (
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {seconds(take.seconds, 1)}
                        {take.likeReference !== null && ` · like it ${take.likeReference.toFixed(2)}`}
                        {' · '}
                        <span className={cn(take.heardErrorRate > LIMITS.broken && 'font-semibold text-red-700 dark:text-red-400')}>CER {percent(take.heardErrorRate)}</span>
                      </span>
                    )}
                    {playing && <PlayedBar audio={player.audio} />}
                  </button>
                )
              }))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function Tries({ detail, onChosen, onTrySet }: { detail: VoiceDetail; onChosen: () => void; onTrySet: (key: string) => void }) {
  const player = usePlayer<Clip>((clip) => clip.url)
  const data = detail.tries
  const candidateNames = new Set(detail.candidates.map((candidate) => candidate.name))
  const colorOf = (candidate: number): number => candidate
  const untried = data ? detail.candidates.filter((candidate) => !data.candidates.some((tried) => tried.name === candidate.name)) : detail.candidates
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Candidates</CardTitle>
          <CardDescription>How the model spoke like each candidate. Listen to the references and the sentences, then choose one.</CardDescription>
        </div>
        {detail.trySets.length > 0 && (
          <Select value={detail.trySet ?? undefined} onValueChange={onTrySet}>
            <SelectTrigger className="w-72" aria-label="The tries to compare"><SelectValue /></SelectTrigger>
            <SelectContent>
              {detail.trySets.map((set) => <SelectItem key={set.key} value={set.key}>{set.key} · {set.references} references, {set.runs} runs</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="sticky top-0 z-10 flex min-h-10 items-center bg-card/95 backdrop-blur">
          <NowPlaying player={player} idle="Play a candidate's reference, its sentences in a row, or one sentence in every candidate. Esc stops." />
        </div>
        {data && (
          <>
            <CandidateTable
              data={data}
              rows={data.candidates.map((_, index) => index)}
              colorOf={colorOf}
              name={(candidate) => {
                const name = data.candidates[candidate]!.name
                const best = data.voices.some((voice) => voice.best === candidate)
                const chosen = detail.recipe.chosen && (detail.recipe.chosen.candidate === name || detail.recipe.chosen.reference === name)
                return (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{candidate + 1}. {name}</span>
                    {best && <Badge variant="secondary" title="The smallest share of broken takes, then the most alike takes">did best</Badge>}
                    {chosen && <Badge>chosen</Badge>}
                  </div>
                )
              }}
              actions={(candidate) => {
                const name = data.candidates[candidate]!.name
                return (
                  <>
                    <Button variant="outline" size="sm" onClick={() => player.play([referenceClip(data, candidate, name, colorOf(candidate))])}><Play />Reference</Button>
                    <Button variant="outline" size="sm" onClick={() => player.play(sentenceClips(data, candidate, name, colorOf(candidate)))}><Play />Sentences</Button>
                    {candidateNames.has(name) && detail.recipe.chosen?.candidate !== name && <ChooseButton detail={detail} candidate={name} onChosen={onChosen} />}
                  </>
                )
              }}
            />
            <p className="text-xs text-muted-foreground">{LEGEND}</p>
            {data.candidates.length > 1 && (
              <SimilarityMatrix
                labels={data.candidates.map((candidate) => candidate.name)}
                values={data.similarity}
                onPair={(a, b) => player.play([a, b].flatMap((candidate) => takeClip(data, candidate, 0, data.sample, data.candidates[candidate]!.name, colorOf(candidate)) ?? []))}
              />
            )}
          </>
        )}
        {untried.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">{data ? 'Not tried on these sentences' : 'Not tried yet'}</div>
            {untried.map((candidate) => (
              <div key={candidate.name} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                <span className="font-medium">{candidate.name}</span>
                <span className="text-xs text-muted-foreground">{candidate.takes} takes, {seconds(candidate.seconds, 1)}, every pair {candidate.weakestPair.toFixed(2)} or more alike</span>
                <Button variant="outline" size="sm" className="ml-auto" onClick={() => player.play([{ key: `reference-${candidate.name}`, url: candidate.url, label: `${candidate.name} · reference`, color: 9 }])}><Play />Reference</Button>
              </div>
            ))}
          </div>
        )}
        {data && <TrySentences data={data} player={player} colorOf={colorOf} />}
      </CardContent>
    </Card>
  )
}

/** One voice: its recipe, the steps of making it, and its candidates as the model spoke like them. */
export function VoicePage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const locale = params.get('locale') ?? 'ja-JP'
  const tries = params.get('tries')
  const detail = useApi<VoiceDetail>(`/api/voices/${id}?locale=${locale}${tries ? `&tries=${encodeURIComponent(tries)}` : ''}`)
  return (
    <main className="mx-auto max-w-screen-2xl space-y-4 px-4 py-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon-sm" asChild><Link to={`/voices?locale=${locale}`} aria-label="Back to the voices"><ArrowLeft /></Link></Button>
        <div className="min-w-0 space-y-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            {id}
            {detail.state === 'loaded' && detail.data.recipe.chosen && <Badge>chosen {detail.data.recipe.chosen.candidate}</Badge>}
          </h1>
          {detail.state === 'loaded' && <p className="max-w-4xl text-sm text-muted-foreground">{detail.data.recipe.description}</p>}
        </div>
      </div>
      {detail.state === 'failed' && <Failure error={detail.error} />}
      {detail.state === 'loading' && <Skeleton className="h-96 w-full" />}
      {detail.state === 'loaded' && (
        <>
          <Steps detail={detail.data} />
          {detail.data.recipe.lines.length > 0 && (
            <Card>
              <CardContent>
                <details>
                  <summary className="cursor-pointer text-sm font-medium">The {detail.data.recipe.lines.length} lines it says in character</summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                    {detail.data.recipe.lines.map((line) => <li key={line.id}>{line.text} <span className="text-xs text-muted-foreground">{line.kind}</span></li>)}
                  </ol>
                </details>
              </CardContent>
            </Card>
          )}
          <Tries detail={detail.data} onChosen={detail.reload} onTrySet={(key) => setParams({ locale, tries: key }, { replace: true })} />
        </>
      )}
    </main>
  )
}
