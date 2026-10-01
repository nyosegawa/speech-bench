import { ChevronLeft, ChevronRight, Mic, Play, Plus, Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Failure } from '@/components/failure.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardContent, CardHeader } from '@/components/ui/card.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import { postBody, useApi, type RecordingSession, type SavedRecording } from '@/lib/api.ts'
import { cn } from '@/lib/utils.ts'
import { decodeTake, formatDb, takeOf, toSixteenKilohertz, verdictOf, wav16, type Take, type Verdict } from './audio.ts'
import { startCapture, type Capture } from './capture.ts'
import { LevelMeter } from './level-meter.tsx'
import { Waveform } from './waveform.tsx'

type Prompt = RecordingSession['prompts'][number]

const VERDICT_CLASS: Record<Verdict['kind'] | 'muted', string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-red-700 dark:text-red-400',
  muted: 'text-muted-foreground'
}

function Kbd({ children }: { children: string }) {
  return <kbd className="ml-1 rounded border px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>
}

function Recorder({ session }: { session: RecordingSession }) {
  const [prompts, setPrompts] = useState<Prompt[]>(() => [
    ...session.prompts,
    ...session.recorded.filter((entry) => !session.prompts.some((prompt) => prompt.id === entry.id)).map((entry) => ({ id: entry.id, kind: 'free', text: entry.text }))
  ])
  const [recorded, setRecorded] = useState(() => new Map(session.recorded.map((entry) => [entry.id, entry])))
  const [index, setIndex] = useState(() => Math.max(0, prompts.findIndex((prompt) => !recorded.has(prompt.id))))
  const prompt = prompts[index]!
  const [text, setText] = useState(() => recorded.get(prompt.id)?.text ?? prompt.text)
  const [capture, setCapture] = useState<Capture | null>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ text: string; kind: Verdict['kind'] | 'muted' } | null>(null)
  const takes = useRef(new Map<string, Take>())
  const [take, setTake] = useState<Take | null>(null)
  const audio = useMemo(() => new Audio(), [])
  const [played, setPlayed] = useState(0)
  const [playing, setPlaying] = useState(false)
  const textArea = useRef<HTMLTextAreaElement>(null)
  const saved = recorded.get(prompt.id)

  useEffect(() => {
    let current = true
    const known = takes.current.get(prompt.id)
    setTake(known ?? null)
    if (!known && saved) {
      decodeTake(saved.url).then((decoded) => {
        takes.current.set(prompt.id, decoded)
        if (current) setTake(decoded)
      }, (reason: unknown) => setStatus({ text: String(reason), kind: 'bad' }))
    }
    return () => {
      current = false
    }
  }, [prompt.id, saved])

  const stopPlaying = useCallback(() => {
    audio.pause()
    setPlaying(false)
    setPlayed(0)
  }, [audio])

  useEffect(() => {
    const ended = (): void => stopPlaying()
    audio.addEventListener('ended', ended)
    return () => {
      audio.removeEventListener('ended', ended)
      audio.pause()
    }
  }, [audio, stopPlaying])

  const play = useCallback((at?: number) => {
    if (!saved || !take || capture) return
    if (playing && at === undefined) return stopPlaying()
    audio.src = `${saved.url}?${Date.now()}`
    audio.currentTime = (at ?? 0) * take.seconds
    void audio.play()
    setPlaying(true)
    const follow = (): void => {
      setPlayed(audio.currentTime / take.seconds)
      if (!audio.paused) requestAnimationFrame(follow)
    }
    requestAnimationFrame(follow)
  }, [audio, saved, take, capture, playing, stopPlaying])

  const moveTo = useCallback((next: number) => {
    if (capture || saving || next < 0 || next >= prompts.length) return
    stopPlaying()
    setIndex(next)
    setText(recorded.get(prompts[next]!.id)?.text ?? prompts[next]!.text)
    setStatus(null)
    window.scrollTo({ top: 0 })
  }, [capture, saving, prompts, recorded, stopPlaying])

  const toggleRecording = useCallback(async () => {
    if (saving) return
    if (!capture) {
      stopPlaying()
      setStatus(null)
      setCapture(await startCapture())
      return
    }
    setCapture(null)
    setSaving(true)
    try {
      const { chunks, rate } = await capture.stop()
      const samples = await toSixteenKilohertz(chunks, rate)
      setStatus({ text: `Saving ${(samples.length / 16_000).toFixed(1)} s…`, kind: 'muted' })
      const entry = await postBody<SavedRecording>(`/api/recordings/${session.locale}/${session.speaker}/${prompt.id}`, wav16(samples), { 'content-type': 'audio/wav', 'x-recording-text': encodeURIComponent(text.trim()) })
      const recording = takeOf(samples)
      takes.current.set(prompt.id, recording)
      const nextRecorded = new Map(recorded).set(prompt.id, entry)
      setRecorded(nextRecorded)
      setPrompts((current) => current.map((item, at) => (at === index ? { ...item, text: entry.text } : item)))
      setTake(recording)
      const verdict = verdictOf(recording)
      const done = prompts.every((item) => nextRecorded.has(item.id))
      setStatus({ text: `Saved ${prompt.id}. ${verdict.text} ${done ? 'Every prompt is recorded.' : verdict.kind === 'ok' ? 'Listen back if you like, then go to the next one.' : ''}`, kind: verdict.kind })
    } catch (reason) {
      setStatus({ text: `Not saved: ${reason instanceof Error ? reason.message : String(reason)}`, kind: 'bad' })
    } finally {
      setSaving(false)
    }
  }, [capture, saving, session, prompt.id, text, recorded, index, prompts, stopPlaying])

  const addFree = (): void => {
    if (capture || saving) return
    setPrompts((current) => [...current, { id: `free-${Date.now()}`, kind: 'free', text: '' }])
    setIndex(prompts.length)
    setText('')
    setStatus({ text: 'Type what you will say, then record.', kind: 'muted' })
    requestAnimationFrame(() => textArea.current?.focus())
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target === textArea.current) return
      if (event.code === 'Space') {
        event.preventDefault()
        toggleRecording().catch((reason: unknown) => setStatus({ text: String(reason), kind: 'bad' }))
      }
      if (event.code === 'ArrowRight') moveTo(index + 1)
      if (event.code === 'ArrowLeft') moveTo(index - 1)
      if (event.code === 'KeyP') play()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toggleRecording, moveTo, index, play])

  const done = prompts.filter((item) => recorded.has(item.id)).length
  const verdict = take ? verdictOf(take) : null
  return (
    <>
      <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-screen-lg space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="font-semibold">Recording <span className="font-normal text-muted-foreground">{session.locale} · {session.speaker}</span></h1>
            <span className="text-sm"><strong className="tabular-nums">{done}</strong> <span className="text-muted-foreground">of {prompts.length} recorded</span></span>
          </div>
          <div className="flex flex-wrap gap-1">
            {prompts.map((item, at) => (
              <button key={item.id} type="button" title={`${at + 1}. ${item.text}`} onClick={() => moveTo(at)}
                className={cn('h-2 w-4 rounded-full', recorded.has(item.id) ? 'bg-emerald-500' : 'bg-muted', at === index && 'ring-2 ring-primary ring-offset-1 ring-offset-background')} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={capture ? 'destructive' : 'default'} disabled={saving} onClick={() => toggleRecording().catch((reason: unknown) => setStatus({ text: String(reason), kind: 'bad' }))}>
              {capture ? <Square /> : <Mic />}{capture ? 'Stop' : saved ? 'Record again' : 'Record'}<Kbd>Space</Kbd>
            </Button>
            <Button variant="outline" disabled={Boolean(capture) || saving || index === 0} onClick={() => moveTo(index - 1)}><ChevronLeft />Previous<Kbd>←</Kbd></Button>
            <span className="flex-1" />
            <Button variant="ghost" disabled={Boolean(capture) || saving} onClick={addFree}><Plus />New free recording</Button>
            <Button variant={saved && !capture ? 'default' : 'outline'} disabled={Boolean(capture) || saving || index === prompts.length - 1} onClick={() => moveTo(index + 1)}>Next<Kbd>→</Kbd><ChevronRight /></Button>
          </div>
          <LevelMeter capture={capture} />
          {status && <p className={cn('text-sm', VERDICT_CLASS[status.kind])}>{status.text}</p>}
        </div>
      </div>
      <main className="mx-auto max-w-screen-lg space-y-4 px-4 py-4 pb-16">
        <Card className="gap-3">
          <CardHeader className="flex flex-row justify-between text-xs text-muted-foreground">
            <span>{prompt.kind} · {prompt.id}</span>
            <span>prompt {index + 1} of {prompts.length}</span>
          </CardHeader>
          <CardContent className="space-y-2">
            <textarea ref={textArea} rows={2} spellCheck={false} value={text} onChange={(event) => setText(event.target.value)}
              className="field-sizing-content w-full resize-none rounded-md border bg-transparent px-3 py-2 text-2xl leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
            <p className="text-sm text-muted-foreground">Press Record, wait half a second, read the text, wait half a second, and stop. Edit the text first if you will say it differently. The microphone is recorded as it is, without echo cancellation, noise suppression or automatic gain.</p>
          </CardContent>
        </Card>
        <Card className="gap-3">
          <CardHeader className="flex flex-row justify-between text-xs text-muted-foreground"><span>Saved recording</span><span><kbd className="font-mono">P</kbd> plays it</span></CardHeader>
          <CardContent>
            {!saved && <p className="text-sm text-muted-foreground">Not recorded yet.</p>}
            {saved && !take && <Skeleton className="h-24 w-full" />}
            {saved && take && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="icon" aria-label={playing ? 'Stop' : 'Play'} onClick={() => play()}>{playing ? <Square /> : <Play />}</Button>
                  <Waveform take={take} played={played} onSeek={(share) => play(share)} />
                </div>
                <p className="text-sm tabular-nums text-muted-foreground">
                  {take.seconds.toFixed(1)} s · loudest {formatDb(take.peakDb)} · room {formatDb(take.noiseDb)} · <span className={VERDICT_CLASS[verdict!.kind]}>{verdict!.text}</span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <ol className="space-y-0.5">
              {prompts.map((item, at) => (
                <li key={item.id}>
                  <button type="button" onClick={() => moveTo(at)} className={cn('flex w-full gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted', at === index && 'bg-muted font-medium')}>
                    <span className="w-4 text-emerald-600">{recorded.has(item.id) ? '✓' : ''}</span>
                    <span className="truncate">{recorded.get(item.id)?.text ?? item.text}</span>
                  </button>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </main>
    </>
  )
}

/** Records a speaker's utterances of the locale's prompts, one after another, with the level of each checked. */
export function RecorderPage() {
  const { locale, speaker } = useParams()
  const session = useApi<RecordingSession>(`/api/recordings/${locale}/${speaker}`)
  if (session.state === 'failed') return <main className="mx-auto max-w-screen-lg space-y-3 px-4 py-6"><Failure error={session.error} /><Link className="text-sm underline" to="/record">Back</Link></main>
  if (session.state === 'loading') return <main className="mx-auto max-w-screen-lg px-4 py-6"><Skeleton className="h-64 w-full" /></main>
  return <Recorder key={`${locale}/${speaker}`} session={session.data} />
}
