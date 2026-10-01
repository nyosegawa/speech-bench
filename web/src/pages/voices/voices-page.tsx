import { Play } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { Failure } from '@/components/failure.tsx'
import { usePlayer } from '@/components/player.tsx'
import { SimilarityMatrix } from '@/components/similarity-matrix.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx'
import { useApi, type ChosenVoices, type VoiceLocales, type VoiceRow } from '@/lib/api.ts'
import { LIMITS } from '@/lib/figures.ts'
import { cn } from '@/lib/utils.ts'
import { CandidateTable, LEGEND } from './candidate-table.tsx'
import { NowPlaying, referenceClip, sentenceClips, takeClip, type Clip, type VoicesData } from './voice-clips.tsx'

const voiceLink = (id: string, locale: string): string => `/voices/${id}?locale=${locale}`

function Progress({ row }: { row: VoiceRow }) {
  if (row.lines === 0) return <span className="text-muted-foreground">described only</span>
  if (row.chosen) return <Badge>chosen {row.chosen.candidate}</Badge>
  if (row.tried > 0) return <Badge variant="secondary">tried</Badge>
  if (row.candidates.length > 0) return <Badge variant="secondary">candidates made</Badge>
  if (row.gathered > 0) return <Badge variant="secondary">takes gathered</Badge>
  return <Badge variant="outline">not started</Badge>
}

/** The chosen voices heard on the same sentences, with how alike every two of them are. */
function ChosenComparison({ locale, chosen }: { locale: string; chosen: ChosenVoices & { voices: VoicesData } }) {
  const player = usePlayer<Clip>((clip) => clip.url)
  const data = chosen.voices
  const rows = data.voices.map((voice) => voice.best)
  const nameOf = (candidate: number): string => chosen.voiceOf[data.candidates[candidate]!.name] ?? data.candidates[candidate]!.name
  const colorOf = (candidate: number): number => rows.indexOf(candidate)
  const nearest = (candidate: number): { other: number; value: number } | null =>
    rows.filter((other) => other !== candidate).map((other) => ({ other, value: data.similarity[candidate]?.[other] ?? -Infinity })).sort((a, b) => b.value - a.value)[0] ?? null
  const compare = (a: number, b: number): void =>
    player.play([a, b].flatMap((candidate) => takeClip(data, candidate, 0, data.sample, nameOf(candidate), colorOf(candidate)) ?? []))
  return (
    <Card>
      <CardHeader>
        <CardTitle>The chosen voices side by side</CardTitle>
        <CardDescription>
          Heard on {chosen.trySet}, the sentences the most of them were tried with.
          {chosen.missing.length > 0 && ` Not tried on them: ${chosen.missing.join(', ')}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex min-h-8 items-center"><NowPlaying player={player} idle="Click a voice in the most alike column, or a cell of the table below, to hear the same sentence in both voices. Esc stops." /></div>
        <CandidateTable
          data={data}
          rows={rows}
          colorOf={colorOf}
          name={(candidate) => <Link className="font-medium hover:underline" to={voiceLink(nameOf(candidate), locale)}>{nameOf(candidate)}</Link>}
          extraHeads={['Most alike voice']}
          extra={(candidate) => {
            const near = nearest(candidate)
            return (
              <TableCell>
                {near && (
                  <button type="button" onClick={() => compare(candidate, near.other)} className={cn('tabular-nums hover:underline', near.value >= LIMITS.alike && 'font-semibold text-red-700 dark:text-red-400')}>
                    {near.value.toFixed(2)} {nameOf(near.other)}
                  </button>
                )}
              </TableCell>
            )
          }}
          actions={(candidate) => (
            <>
              <Button variant="outline" size="sm" onClick={() => player.play([referenceClip(data, candidate, nameOf(candidate), colorOf(candidate))])}><Play />Reference</Button>
              <Button variant="outline" size="sm" onClick={() => player.play(sentenceClips(data, candidate, nameOf(candidate), colorOf(candidate)))}><Play />Sentences</Button>
            </>
          )}
        />
        <p className="text-xs text-muted-foreground">{LEGEND} Most alike voice: the other chosen voice whose takes are most like this one's; red at {LIMITS.alike} or more, where takes of one description were heard as one voice.</p>
        <SimilarityMatrix labels={rows.map(nameOf)} values={rows.map((a) => rows.map((b) => data.similarity[a]?.[b] ?? null))} onPair={(a, b) => compare(rows[a]!, rows[b]!)} />
      </CardContent>
    </Card>
  )
}

/** The voices of the recipes of one locale, how far each has been made, and the chosen ones compared. */
export function VoicesPage() {
  const [params, setParams] = useSearchParams()
  const locales = useApi<VoiceLocales>('/api/voice-locales')
  const locale = params.get('locale') ?? (locales.state === 'loaded' ? locales.data[0] ?? null : null)
  return (
    <main className="mx-auto max-w-screen-2xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Voices</h1>
          <p className="text-sm text-muted-foreground">Voices for models that have none built in: takes gathered from a description, candidate references cut from them, tried, and one chosen by ear.</p>
        </div>
        {locales.state === 'loaded' && locales.data.length > 1 && locale && (
          <Select value={locale} onValueChange={(value) => setParams({ locale: value })}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{locales.data.map((entry) => <SelectItem key={entry} value={entry}>{entry}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </div>
      {locales.state === 'failed' && <Failure error={locales.error} />}
      {locales.state === 'loaded' && locales.data.length === 0 && <Failure error="The bench has no voice recipes; add prompts/voices-<locale>.json." />}
      {locale && <VoiceList locale={locale} />}
    </main>
  )
}

function VoiceList({ locale }: { locale: string }) {
  const voices = useApi<VoiceRow[]>(`/api/voices?locale=${locale}`)
  const chosen = useApi<ChosenVoices>(`/api/voice-similarity?locale=${locale}`)
  return (
    <>
      {voices.state === 'failed' && <Failure error={voices.error} />}
      {voices.state === 'loading' && <Skeleton className="h-96 w-full" />}
      {voices.state === 'loaded' && (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Voice</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Runs gathered</TableHead>
                  <TableHead className="text-right">Candidates</TableHead>
                  <TableHead className="text-right">Runs tried</TableHead>
                  <TableHead>Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {voices.data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-4 whitespace-normal">
                      <Link className="font-medium hover:underline" to={voiceLink(row.id, locale)}>{row.id}</Link>
                      <div className="line-clamp-2 max-w-3xl text-xs text-muted-foreground">{row.description}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.lines}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.gathered}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.candidates.length}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.tried}</TableCell>
                    <TableCell><Progress row={row} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {chosen.state === 'failed' && <Failure error={chosen.error} />}
      {chosen.state === 'loading' && <Skeleton className="h-64 w-full" />}
      {chosen.state === 'loaded' && chosen.data.voices && <ChosenComparison locale={locale} chosen={{ ...chosen.data, voices: chosen.data.voices }} />}
    </>
  )
}
