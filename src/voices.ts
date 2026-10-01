import fs from 'node:fs'
import path from 'node:path'
import { heardErrorRate, takeUrl, type ListenedRun } from './listen.ts'
import { semitoneSpread } from './pitch.ts'
import type { ReferenceManifest } from './references.ts'
import type { SentenceRecord } from './results.ts'
import { across, pairwise } from './speaker.ts'

const PAGE = path.join(import.meta.dirname, 'voices-page.html')

/** A sentence heard with more than this share of its characters wrong has broken down, as on the listening page. */
const BROKEN = 0.3

/** A take as the voices page plays it. */
export interface VoiceTake {
  url: string
  seconds: number
  transcript: string
  heardErrorRate: number
  pitchHz: number | null
  likeReference: number | null
}

/** A reference voice and the runs that spoke like it, summed up over all their sentences. */
export interface Candidate {
  name: string
  reference: { url: string; seconds: number; texts: string[] }
  runs: string[]
  sameVoice: number | null
  likeReference: number | null
  heardErrorRate: number
  broken: number
  pitchHz: number | null
  pitchSpread: number
  medianFirstAudioSeconds: number
}

/** What the voices page's script reads. */
export interface VoicesPageData {
  title: string
  /** What the names of every voice share, said once. */
  shared: string
  /** Each voice with its candidates, as indices into `candidates`, and the one that did best. */
  voices: Array<{ name: string; candidates: number[]; best: number }>
  candidates: Candidate[]
  /** The sentence each voice is played with when two voices are compared. */
  sample: number
  sentences: Array<{ id: string; kind: string; text: string; takes: Array<Array<VoiceTake | null>> }>
  /** The mean similarity of every take of one candidate with every take of another, or of every pair within one. */
  similarity: Array<Array<number | null>>
}

const mean = (values: readonly number[]): number | null => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length)
const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN
const defined = <T>(values: ReadonlyArray<T | null | undefined>): T[] => values.filter((value): value is T => value !== null && value !== undefined)

/**
 * The prefix every name has up to a comma, such as the model all the voices were made with, and the names
 * without it.
 */
export function splitShared(names: readonly string[]): { shared: string; rest: string[] } {
  const cut = names.reduce((length, name) => {
    let common = 0
    while (common < length && name[common] === names[0]![common]) common++
    return common
  }, names[0]?.length ?? 0)
  const comma = names[0]?.lastIndexOf(', ', cut - 2) ?? -1
  if (names.length < 2 || comma < 0) return { shared: '', rest: [...names] }
  return { shared: names[0]!.slice(0, comma), rest: names.map((name) => name.slice(comma + 2)) }
}

/**
 * The data of a page for choosing one reference per voice: the runs that spoke like a reference, grouped by
 * the reference, and the references grouped by the voice their takes were gathered from, as the manifest
 * of each names it. A candidate's sameness of voice is the mean similarity of every pair of its takes over
 * all its runs, since one voice has to hold across seeds; the best candidate of a voice has the fewest
 * broken sentences and then the most alike takes. `page` is where the page will be written, which the audio
 * is linked relative to.
 */
export function voicesData(runs: readonly ListenedRun[], reference: (name: string) => { manifest: ReferenceManifest; file: string }, page: string, title: string): VoicesPageData {
  const spoken = runs.filter((entry) => entry.run.reference !== null)
  const setNames = new Set(spoken.map((entry) => entry.run.set.name))
  if (setNames.size !== 1) throw new Error(`the runs that spoke like a reference spoke ${setNames.size === 0 ? 'no set' : `different sets of sentences (${[...setNames].join(', ')})`}; name the result files of one set`)
  const byReference = new Map<string, ListenedRun[]>()
  for (const entry of spoken) byReference.set(entry.run.reference!.name, [...(byReference.get(entry.run.reference!.name) ?? []), entry])
  for (const [name, entries] of byReference) {
    if (new Set(entries.map((entry) => entry.run.durationScale)).size > 1) throw new Error(`the runs that spoke like ${name} had their lengths scaled differently; name the result files of one length factor`)
  }
  const names = [...byReference.keys()].sort()
  const groups = [...new Set(names.map((name) => reference(name).manifest.group))].sort()
  const candidateRuns = names.map((name) => byReference.get(name)!.sort((a, b) => (a.run.seed ?? 0) - (b.run.seed ?? 0)))
  const locale = spoken[0]!.run.set.locale
  const embeddingsOf = (entries: readonly ListenedRun[]): Float32Array[] => entries.flatMap((entry) => defined(entry.sentences.map((record) => entry.embeddings[record.id])))
  const recordsOf = (entries: readonly ListenedRun[]): Array<{ entry: ListenedRun; record: SentenceRecord }> => entries.flatMap((entry) => entry.sentences.map((record) => ({ entry, record })))

  const candidates: Candidate[] = names.map((name, index) => {
    const entries = candidateRuns[index]!
    const { manifest, file } = reference(name)
    const taken = recordsOf(entries)
    const pitches = defined(taken.map(({ entry, record }) => entry.pitches[record.id]))
    return {
      name,
      reference: { url: path.relative(path.dirname(page), file).split(path.sep).map(encodeURIComponent).join('/'), seconds: manifest.seconds, texts: manifest.takes.map((take) => take.text) },
      runs: entries.map((entry) => (entry.run.seed === null ? entry.run.machine.hostname : `seed ${entry.run.seed}`)),
      sameVoice: mean(pairwise(embeddingsOf(entries))),
      likeReference: mean(defined(taken.map(({ entry, record }) => entry.likeReference[record.id]))),
      heardErrorRate: heardErrorRate(taken.map(({ record }) => record), locale),
      broken: taken.filter(({ record }) => heardErrorRate([record], locale) > BROKEN).length,
      pitchHz: pitches.length > 0 ? median(pitches) : null,
      pitchSpread: semitoneSpread(pitches),
      medianFirstAudioSeconds: median(taken.map(({ record }) => record.firstAudioSeconds))
    }
  })
  const rank = (a: number, b: number): number => candidates[a]!.broken - candidates[b]!.broken || (candidates[b]!.sameVoice ?? 0) - (candidates[a]!.sameVoice ?? 0)
  const voices = groups.map((group) => {
    const members = names.flatMap((name, index) => (reference(name).manifest.group === group ? [index] : []))
    return { name: group, candidates: members, best: [...members].sort(rank)[0]! }
  })
  const { shared, rest } = splitShared(voices.map((voice) => voice.name))
  const embeddings = candidateRuns.map(embeddingsOf)
  const similarity = embeddings.map((left, a) => embeddings.map((right, b) => mean(a === b ? pairwise(left) : across(left, right))))
  const sentences = candidateRuns[0]![0]!.sentences
  return {
    title,
    shared,
    voices: voices.map((voice, index) => ({ ...voice, name: rest[index]! })),
    candidates,
    sample: sentences.reduce((longest, sentence, index) => (sentence.text.length > sentences[longest]!.text.length ? index : longest), 0),
    sentences: sentences.map((sentence) => ({
      id: sentence.id,
      kind: sentence.kind,
      text: sentence.text,
      takes: candidateRuns.map((entries) => entries.map((entry) => {
        const record = entry.sentences.find((candidate) => candidate.id === sentence.id)
        if (!record) return null
        return { url: takeUrl(page, entry, record), seconds: record.audioSeconds, transcript: record.transcript, heardErrorRate: heardErrorRate([record], locale), pitchHz: entry.pitches[record.id] ?? null, likeReference: entry.likeReference[record.id] ?? null }
      }))
    })),
    similarity: similarity.map((row) => row.map((value) => (value === null ? null : Number(value.toFixed(4)))))
  }
}

/** The voices page, with its data embedded in a script element safely. */
export function voicesPage(data: VoicesPageData): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return fs.readFileSync(PAGE, 'utf8').replace('__TITLE__', data.title.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)).replace('__DATA__', () => json)
}
