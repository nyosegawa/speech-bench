import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { medianPitch } from './pitch.ts'
import { readResultFile } from '../measure/result-file/file.ts'
import { takeFile } from '../measure/runs.ts'
import { MIN_VOICED_SECONDS, voicedSeconds } from './speaker.ts'
import { readWav, type Pcm } from '../core/wav.ts'

/** What is read from one synthesized sentence: its voice, its median pitch and, with voice enough, its speaker embedding. */
export interface TakeAnalysis {
  voicedSeconds: number
  pitchHz: number | null
  embedding: Float32Array | null
}

/** Raised when how an analysis is computed changes, so that the analyses made the earlier way are made again. */
const ANALYSIS_VERSION = 1

/**
 * An analysis as it is kept: what it was made with (the version of the computation and the speaker model) and
 * the takes of the run in whose folder it lies. It carries no version of its form: one that does not have this
 * form is made again, as it can always be.
 */
const storedAnalysis = z.object({
  version: z.number(),
  speakerModel: z.string(),
  takes: z.record(z.string(), z.object({ voicedSeconds: z.number(), pitchHz: z.number().nullable(), embedding: z.string().nullable() }))
})
type StoredAnalysis = z.infer<typeof storedAnalysis>

const encode = (embedding: Float32Array): string => Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength).toString('base64')
const decode = (base64: string): Float32Array => {
  const bytes = Buffer.from(base64, 'base64')
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

/** The analysis kept in a file, when it was made the way and with the model asked for, of exactly these takes. */
function keptAnalysis(stored: string, speakerModel: string, takes: readonly string[]): StoredAnalysis | null {
  if (!fs.existsSync(stored)) return null
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(stored, 'utf8'))
  } catch {
    return null
  }
  const kept = storedAnalysis.safeParse(raw)
  if (!kept.success || kept.data.version !== ANALYSIS_VERSION || kept.data.speakerModel !== speakerModel) return null
  const keptTakes = Object.keys(kept.data.takes)
  return keptTakes.length === takes.length && takes.every((id) => id in kept.data.takes) ? kept.data : null
}

/**
 * The analysis of every sentence of a synthesis run, kept beside its result file in `analysis.json` and made
 * again when it was made with another speaker model, another version of the analysis or of other takes, or does
 * not read. Embedding and pitch take most of the time of a listening page: 40 runs of 20 sentences took 5 minutes
 * (2026-10-01, M5).
 */
export function analyzeRun(file: string, embedder: { model: { id: string }; embed(pcm: Pcm): Float32Array }): Record<string, TakeAnalysis> {
  const parsed = readResultFile(file)
  if (!('sentences' in parsed)) throw new Error(`${file} is not a speech synthesis run`)
  const stored = path.join(path.dirname(file), 'analysis.json')
  const kept = keptAnalysis(stored, embedder.model.id, parsed.sentences.map((record) => record.id))
  if (kept) return Object.fromEntries(Object.entries(kept.takes).map(([id, take]) => [id, { ...take, embedding: take.embedding === null ? null : decode(take.embedding) }]))
  const takes: Record<string, TakeAnalysis> = {}
  for (const record of parsed.sentences) {
    const pcm = readWav(fs.readFileSync(takeFile(file, record)))
    const voiced = voicedSeconds(pcm)
    takes[record.id] = { voicedSeconds: voiced, pitchHz: medianPitch(pcm), embedding: voiced >= MIN_VOICED_SECONDS ? embedder.embed(pcm) : null }
  }
  const toStore: StoredAnalysis = {
    version: ANALYSIS_VERSION,
    speakerModel: embedder.model.id,
    takes: Object.fromEntries(Object.entries(takes).map(([id, take]) => [id, { ...take, embedding: take.embedding === null ? null : encode(take.embedding) }]))
  }
  fs.writeFileSync(stored, `${JSON.stringify(toStore)}\n`)
  return takes
}
