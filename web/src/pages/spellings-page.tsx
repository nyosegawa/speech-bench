import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Failure } from '@/components/failure.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Checkbox } from '@/components/ui/checkbox.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import { useApi, type Spellings } from '@/lib/api.ts'

type Sentence = Spellings['sentences'][number]

/** A sentence with its readings above the parts they read, and each bracketed stretch followed by its other spellings. */
function Annotated({ sentence }: { sentence: Sentence }) {
  return (
    <p className="text-lg leading-[2.6]">
      {sentence.segments.map((segment, index) => {
        const pieces = segment.pieces.map((piece, at) =>
          piece.readings.length === 0
            ? <span key={at}>{piece.text}</span>
            : <ruby key={at}>{piece.text}<rt className="text-[0.55em] text-muted-foreground">{piece.readings.join('／')}</rt></ruby>)
        if (!segment.bracketed) return <span key={index}>{pieces}</span>
        return (
          <span key={index}>
            <span className="border-b-2 border-amber-500/70 bg-amber-500/10 px-0.5">{pieces}</span>
            {segment.spellings.map((spelling) => <Badge key={spelling} variant="outline" className="mx-0.5 align-middle text-sm font-normal">{spelling}</Badge>)}
            {segment.optional && <Badge variant="outline" className="mx-0.5 align-middle text-sm font-normal text-muted-foreground">may be left out</Badge>}
          </span>
        )
      })}
    </p>
  )
}

const matches = (sentence: Sentence, query: string): boolean => {
  const text = [sentence.reference, sentence.note ?? '', ...sentence.segments.flatMap((segment) => [...segment.spellings, ...segment.pieces.flatMap((piece) => piece.readings)])].join('\n')
  return text.toLowerCase().includes(query.toLowerCase())
}

/** The annotations of accepted spellings of one source: every sentence with its readings, other spellings and note. */
export function SpellingsPage() {
  const [params, setParams] = useSearchParams()
  const chosen = params.get('source')
  const data = useApi<Spellings>(`/api/spellings${chosen ? `?source=${encodeURIComponent(chosen)}` : ''}`)
  const [query, setQuery] = useState('')
  const [withSpellings, setWithSpellings] = useState(false)
  const [withNotes, setWithNotes] = useState(false)
  const shown = useMemo(() => {
    if (data.state !== 'loaded') return []
    return data.data.sentences
      .map((sentence, index) => ({ sentence, index }))
      .filter(({ sentence }) => (!withSpellings || sentence.segments.some((segment) => segment.bracketed)) && (!withNotes || sentence.note !== null) && (query.trim() === '' || matches(sentence, query.trim())))
  }, [data, query, withSpellings, withNotes])

  if (data.state === 'failed') return <main className="mx-auto max-w-screen-xl px-4 py-6"><Failure error={data.error} /></main>
  if (data.state === 'loading') return <main className="mx-auto max-w-screen-xl px-4 py-6"><Skeleton className="h-96 w-full" /></main>
  const { sources, source, sentences } = data.data
  const summary = sources.find((entry) => entry.source === source)
  return (
    <main className="mx-auto max-w-screen-xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold">Accepted spellings</h1>
        <p className="text-sm text-muted-foreground">
          The readings and other spellings a transcription may use for each reference sentence, made from the sentence alone.
          {summary && ` ${summary.sentences} sentences, ${summary.withSpellings} with other spellings, ${summary.withNotes} with notes.`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Select value={source} onValueChange={(value) => setParams({ source: value })}>
          <SelectTrigger className="w-64" aria-label="Source"><SelectValue /></SelectTrigger>
          <SelectContent>{sources.map((entry) => <SelectItem key={entry.source} value={entry.source}>{entry.source}</SelectItem>)}</SelectContent>
        </Select>
        <Input className="w-64" placeholder="Search sentences, readings, spellings" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Label className="flex items-center gap-2 font-normal"><Checkbox checked={withSpellings} onCheckedChange={(value) => setWithSpellings(value === true)} />With other spellings</Label>
        <Label className="flex items-center gap-2 font-normal"><Checkbox checked={withNotes} onCheckedChange={(value) => setWithNotes(value === true)} />With notes</Label>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">{shown.length} of {sentences.length} sentences</span>
      </div>
      <div className="divide-y rounded-lg border">
        {shown.map(({ sentence, index }) => (
          <section key={index} className="space-y-1 px-4 py-3">
            <div className="flex items-baseline gap-3 text-xs text-muted-foreground">
              <span className="tabular-nums">#{index}</span>
              <span>{sentence.by}, skill {sentence.skill}, {sentence.at}</span>
            </div>
            <Annotated sentence={sentence} />
            {sentence.note && <p className="text-sm text-muted-foreground">{sentence.note}</p>}
          </section>
        ))}
      </div>
    </main>
  )
}
