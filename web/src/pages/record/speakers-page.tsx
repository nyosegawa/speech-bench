import { Mic } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Failure } from '@/components/failure.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx'
import { useApi, type RecordLocales, type SpeakerRow } from '@/lib/api.ts'

/** A speaker names a folder, so it is kept to characters every file system accepts. */
const SPEAKER = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** The speakers recorded so far, and a start for a new one. */
export function SpeakersPage() {
  const speakers = useApi<SpeakerRow[]>('/api/recordings')
  const locales = useApi<RecordLocales>('/api/record-locales')
  const [locale, setLocale] = useState<string | null>(null)
  const [speaker, setSpeaker] = useState('')
  const navigate = useNavigate()
  const chosenLocale = locale ?? (locales.state === 'loaded' ? locales.data[0] ?? null : null)
  return (
    <main className="mx-auto max-w-screen-lg space-y-4 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold">Record</h1>
        <p className="text-sm text-muted-foreground">Record utterances to measure recognition on, one speaker at a time. The recordings stay in the data folder and are never committed.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>A new speaker</CardTitle>
          <CardDescription>The prompts of the locale are read aloud one by one; free recordings can be added.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
            event.preventDefault()
            if (chosenLocale && SPEAKER.test(speaker)) navigate(`/record/${chosenLocale}/${speaker}`)
          }}>
            <div className="grid gap-1.5">
              <Label>Locale</Label>
              {locales.state === 'loaded' && chosenLocale ? (
                <Select value={chosenLocale} onValueChange={setLocale}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>{locales.data.map((entry) => <SelectItem key={entry} value={entry}>{entry}</SelectItem>)}</SelectContent>
                </Select>
              ) : <div className="h-9 w-32 rounded-lg border" />}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="speaker">Speaker</Label>
              <Input id="speaker" className="w-56" placeholder="lower-case name" value={speaker} onChange={(event) => setSpeaker(event.target.value)} aria-invalid={speaker !== '' && !SPEAKER.test(speaker)} />
            </div>
            <Button type="submit" disabled={!chosenLocale || !SPEAKER.test(speaker)}><Mic />Start recording</Button>
          </form>
        </CardContent>
      </Card>
      {speakers.state === 'failed' && <Failure error={speakers.error} />}
      {speakers.state === 'loaded' && speakers.data.length > 0 && (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Speaker</TableHead>
                  <TableHead>Locale</TableHead>
                  <TableHead className="text-right">Recordings</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {speakers.data.map((row) => (
                  <TableRow key={`${row.locale}/${row.speaker}`}>
                    <TableCell className="pl-4 font-medium">{row.speaker}</TableCell>
                    <TableCell>{row.locale}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.recordings}</TableCell>
                    <TableCell className="text-right"><Button variant="outline" size="sm" asChild><Link to={`/record/${row.locale}/${row.speaker}`}>Continue</Link></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
