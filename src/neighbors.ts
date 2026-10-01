import fs from 'node:fs'
import path from 'node:path'
import { analyzeRun } from './analysis.ts'
import type { SpeakerEmbedder } from './engines/speaker-embedding.ts'
import { parseResultFile, type TtsRunRecord } from './results.ts'
import { takeFile } from './runs.ts'
import { cosine } from './speaker.ts'

const PAGE = path.join(import.meta.dirname, 'neighbors-page.html')

/**
 * The synthesized speech that is meant to be one voice: one model asked for one voice, with the same built-in
 * voice or description, loaded the same way on the same GPU. Seeds and sentences vary within a group.
 */
export function voiceGroup(run: TtsRunRecord): { key: string; name: string; detail: string } {
  const voice = [run.design?.id ?? run.voice, run.reference ? `reference ${run.reference.name}` : null, run.durationScale === null ? null : `length ×${run.durationScale}`].filter(Boolean).join(' + ') || 'no voice'
  const options = Object.entries(run.runtime.options).map(([name, value]) => `${name}=${value}`).join(', ')
  const gpu = run.machine.gpus.join(' + ')
  return {
    key: [run.set.locale, run.model.id, voice, options, gpu].join('\u0000'),
    name: `${run.model.label}, ${voice}`,
    detail: [run.design?.instruction, gpu, options].filter(Boolean).join(' · ')
  }
}

/** One synthesized sentence on the page: which run and sentence it is, and where its audio is. */
export interface NeighborTake {
  label: string
  sentence: string
  text: string
  url: string
  seconds: number
}


/** A group of takes with enough voice to embed, the similarity of every pair of them in the page's order, and its largest sets. */
export interface NeighborGroup {
  name: string
  detail: string
  takes: NeighborTake[]
  similarity: number[][]
  sets: { pairs: Record<string, VoiceSet>; center: Record<string, VoiceSet> }
  /** Takes left out for having less than 1.5 s of voice. */
  tooShort: number
}

/**
 * An order in which similar takes stand together, from average-linkage clustering: the two closest clusters
 * are joined until one is left, and the takes are read off the tree. Clusters of one voice then show as
 * blocks along the diagonal of the similarity table.
 */
export function clusteredOrder(similarity: readonly (readonly number[])[]): number[] {
  const clusters = similarity.map((_, index) => [index])
  const linkage = (a: number[], b: number[]): number => a.reduce((sum, i) => sum + b.reduce((inner, j) => inner + similarity[i]![j]!, 0), 0) / (a.length * b.length)
  while (clusters.length > 1) {
    let best = { a: 0, b: 1, value: -Infinity }
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        const value = linkage(clusters[a]!, clusters[b]!)
        if (value > best.value) best = { a, b, value }
      }
    }
    clusters[best.a] = [...clusters[best.a]!, ...clusters[best.b]!]
    clusters.splice(best.b, 1)
  }
  return clusters[0] ?? []
}

const takeLabel = (run: TtsRunRecord, id: string): string => `${id}${run.seed === null ? '' : ` · seed ${run.seed}`}`

/** A take with its audio file and speaker embedding, in a group of one intended voice. */
export interface EmbeddedTake {
  label: string
  sentence: string
  seed: number | null
  text: string
  audio: string
  seconds: number
  embedding: Float32Array
}

/** The takes of one intended voice, embedded, with the number left out for too little voice. */
export interface EmbeddedGroup {
  name: string
  detail: string
  takes: EmbeddedTake[]
  tooShort: number
}

/** The takes of the result files in groups of one intended voice, each take with enough voice embedded. */
export function embedGroups(files: readonly string[], embedder: SpeakerEmbedder): EmbeddedGroup[] {
  const groups = new Map<string, EmbeddedGroup>()
  for (const file of files) {
    const parsed = parseResultFile(fs.readFileSync(file, 'utf8').split('\n'))
    if (!('sentences' in parsed)) continue
    const { key, name, detail } = voiceGroup(parsed.run)
    const group = groups.get(key) ?? { name, detail, takes: [], tooShort: 0 }
    groups.set(key, group)
    const analysis = analyzeRun(file, embedder)
    for (const record of parsed.sentences) {
      const embedding = analysis[record.id]?.embedding
      if (!embedding) {
        group.tooShort++
        continue
      }
      group.takes.push({ label: takeLabel(parsed.run, record.id), sentence: record.id, seed: parsed.run.seed, text: record.text, audio: takeFile(file, record), seconds: record.audioSeconds, embedding })
    }
  }
  return [...groups.values()].filter((group) => group.takes.length >= 2)
}

export const similarityOf = (takes: readonly EmbeddedTake[]): number[][] => takes.map((a) => takes.map((b) => cosine(a.embedding, b.embedding)))

/** A set of takes, as indices, around a center: the first member. */
export interface VoiceSet {
  members: number[]
  weakest: number
}

/**
 * The largest set around one center, ties to the higher mean similarity to it, with no sentence twice. Taken
 * in order of likeness to the center, a take joins when it is at least `threshold` alike to the center or,
 * with `everyPair`, to every take already in the set, which keeps the set one voice throughout rather than
 * a chain of voices each close to the center. The members are in order of likeness to the center.
 */
export function largestSet(similarity: readonly (readonly number[])[], sentences: readonly string[], threshold: number, everyPair: boolean): VoiceSet {
  let best = { members: [0], mean: 0 }
  similarity.forEach((row, center) => {
    const candidates = row.map((value, other) => ({ value, other })).filter(({ value, other }) => other !== center && value >= threshold).sort((a, b) => b.value - a.value)
    const members = [center]
    const used = new Set([sentences[center]])
    for (const { other } of candidates) {
      if (used.has(sentences[other])) continue
      if (everyPair && members.some((member) => similarity[other]![member]! < threshold)) continue
      used.add(sentences[other])
      members.push(other)
    }
    const mean = members.reduce((sum, member) => sum + row[member]!, 0) / members.length
    if (members.length > best.members.length || (members.length === best.members.length && mean > best.mean)) best = { members, mean }
  })
  const pairs = best.members.flatMap((a, index) => best.members.slice(index + 1).map((b) => similarity[a]![b]!))
  return { members: best.members, weakest: pairs.length > 0 ? Math.min(...pairs) : 1 }
}

/** The thresholds the page offers, from 0.50 to 0.95. */
const THRESHOLDS = Array.from({ length: 46 }, (_, index) => (50 + index) / 100)

/**
 * The page's data for each group: its takes ordered so that similar takes stand together, their
 * similarities, and the largest sets at every threshold the page offers, both held by every pair and held
 * around the center. `page` is where the page will be written, which the audio is linked relative to.
 */
export function neighborGroups(groups: readonly EmbeddedGroup[], page: string): NeighborGroup[] {
  return groups.map((group) => {
    const order = clusteredOrder(similarityOf(group.takes))
    const takes = order.map((index) => group.takes[index]!)
    const similarity = similarityOf(takes)
    const sentences = takes.map((take) => take.sentence)
    const sets = (everyPair: boolean): Record<string, VoiceSet> => Object.fromEntries(THRESHOLDS.map((threshold) => [threshold.toFixed(2), largestSet(similarity, sentences, threshold, everyPair)]))
    return {
      name: group.name,
      detail: group.detail,
      takes: takes.map(({ label, sentence, text, audio, seconds }) => ({ label, sentence, text, seconds, url: path.relative(path.dirname(page), audio).split(path.sep).map(encodeURIComponent).join('/') })),
      similarity: similarity.map((row) => row.map((value) => Number(value.toFixed(4)))),
      sets: { pairs: sets(true), center: sets(false) },
      tooShort: group.tooShort
    }
  })
}

/** The page, with the groups embedded in a script element safely. */
export function neighborsPage(groups: readonly NeighborGroup[]): string {
  return fs.readFileSync(PAGE, 'utf8').replace('__DATA__', () => JSON.stringify(groups).replace(/</g, '\\u003c'))
}
