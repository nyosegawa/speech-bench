import fs from 'node:fs'
import path from 'node:path'
import { isSafeName } from './datasets/recordings.ts'
import { sha256Of } from './download.ts'
import type { EmbeddedTake } from './neighbors.ts'
import { referencesDir } from './paths.ts'
import { encodeWav16, readWav, resample } from './wav.ts'

/** The silence between two takes of a reference, which keeps one take's end from running into the next. */
const GAP_SECONDS = 0.3

/** A reference voice as a run uses it: its name, its WAVE file, the file's sha256 and its length. */
export interface ReferenceVoice {
  name: string
  file: string
  sha256: string
  seconds: number
}

/** What a reference was made of, written beside its WAVE file. */
export interface ReferenceManifest {
  name: string
  group: string
  /** The similarity every pair of the set held to, or null for takes named by hand. */
  threshold: number | null
  seconds: number
  takes: Array<{ audio: string; label: string; text: string; seconds: number; likenessToCenter: number }>
  meanSimilarity: number
  weakestPair: number
}

const filesOf = (name: string): { wav: string; manifest: string } => {
  if (!isSafeName(name)) throw new Error(`reference name ${JSON.stringify(name)} is not lower-case letters, digits, - and _`)
  return { wav: path.join(referencesDir(), `${name}.wav`), manifest: path.join(referencesDir(), `${name}.json`) }
}

/**
 * Writes the takes, in the order given, one after another with 0.3 s of silence between, until they reach
 * `seconds`, or all of them when `seconds` is null, at the sample rate of the first. Irodori-TTS's README
 * recommends several short clean clips of one speaker over one long recording, about 30 s in all capturing
 * most of the gain, and at most 120 s.
 */
export function writeReference(name: string, group: string, threshold: number | null, takes: readonly EmbeddedTake[], similarity: (a: number, b: number) => number, seconds: number | null): ReferenceManifest {
  const { wav, manifest } = filesOf(name)
  const chosen: number[] = []
  let total = 0
  for (const [index, take] of takes.entries()) {
    if (seconds !== null && total >= seconds) break
    chosen.push(index)
    total += take.seconds + (chosen.length > 1 ? GAP_SECONDS : 0)
  }
  if (seconds !== null && total < seconds) throw new Error(`the set holds ${total.toFixed(1)} s, less than the ${seconds} s asked for; lower the threshold or synthesize more takes`)
  if (chosen.length < 2) throw new Error('a reference is made of two takes or more')
  const rate = readWav(fs.readFileSync(takes[chosen[0]!]!.audio)).sampleRate
  const parts = chosen.map((index) => resample(readWav(fs.readFileSync(takes[index]!.audio)), rate).samples)
  const gap = Math.round(GAP_SECONDS * rate)
  const samples = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0) + gap * (parts.length - 1))
  let offset = 0
  for (const part of parts) {
    samples.set(part, offset)
    offset += part.length + gap
  }
  fs.mkdirSync(referencesDir(), { recursive: true })
  fs.writeFileSync(wav, encodeWav16({ sampleRate: rate, samples }))
  const pairs = chosen.flatMap((a, position) => chosen.slice(position + 1).map((b) => similarity(a, b)))
  const written: ReferenceManifest = {
    name,
    group,
    threshold,
    seconds: samples.length / rate,
    takes: chosen.map((index) => ({ audio: takes[index]!.audio, label: takes[index]!.label, text: takes[index]!.text, seconds: takes[index]!.seconds, likenessToCenter: similarity(chosen[0]!, index) })),
    meanSimilarity: pairs.reduce((sum, value) => sum + value, 0) / pairs.length,
    weakestPair: Math.min(...pairs)
  }
  fs.writeFileSync(manifest, `${JSON.stringify(written, null, 2)}\n`)
  return written
}

/** The WAVE file of a reference voice on this machine, which fails when there is none. */
export function referenceFile(name: string): string {
  const { wav } = filesOf(name)
  if (!fs.existsSync(wav)) throw new Error(`there is no reference voice ${name}: ${wav} does not exist; make one with "node src/cli.ts reference"`)
  return wav
}

/** A reference voice by name, from this machine's references folder. */
export async function loadReference(name: string): Promise<ReferenceVoice> {
  const wav = referenceFile(name)
  const pcm = readWav(fs.readFileSync(wav))
  return { name, file: wav, sha256: await sha256Of(wav), seconds: pcm.samples.length / pcm.sampleRate }
}

/**
 * Candidate references from one set: groups of its takes that each reach `seconds`, no take in two groups,
 * the most alike first. A group starts from the most alike pair of the takes left and grows by the take
 * most alike to all of it until it is long enough. One take can sound unlike the voice it clones into, so
 * several candidates are tried and compared by what they make.
 */
export function candidateGroups(members: readonly number[], similarity: (a: number, b: number) => number, secondsOf: (take: number) => number, seconds: number, count: number): number[][] {
  const left = new Set(members)
  const groups: number[][] = []
  const length = (group: readonly number[]): number => group.reduce((sum, take) => sum + secondsOf(take), 0) + GAP_SECONDS * (group.length - 1)
  while (groups.length < count && left.size >= 2) {
    let best = { a: -1, b: -1, value: -Infinity }
    for (const a of left) {
      for (const b of left) {
        if (a < b && similarity(a, b) > best.value) best = { a, b, value: similarity(a, b) }
      }
    }
    const group = [best.a, best.b]
    left.delete(best.a)
    left.delete(best.b)
    while (length(group) < seconds && left.size > 0) {
      const next = [...left].sort((x, y) => Math.min(...group.map((member) => similarity(y, member))) - Math.min(...group.map((member) => similarity(x, member))))[0]!
      group.push(next)
      left.delete(next)
    }
    if (length(group) < seconds) break
    groups.push(group)
  }
  return groups
}
