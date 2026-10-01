import fs from 'node:fs'
import path from 'node:path'
import { medianPitch } from './pitch.ts'
import { parseResultFile } from '../measure/results.ts'
import { takeFile } from '../measure/runs.ts'
import { MIN_VOICED_SECONDS, voicedSeconds } from './speaker.ts'
import { readWav, type Pcm } from '../core/wav.ts'

/** What is read from one synthesized sentence: its voice, its median pitch and, with voice enough, its speaker embedding. */
export interface TakeAnalysis {
  voicedSeconds: number
  pitchHz: number | null
  embedding: Float32Array | null
}

/** Raised when what an analysis holds or how it is computed changes, so that kept analyses are made again. */
const ANALYSIS_VERSION = 1

interface StoredAnalysis {
  version: number
  speakerModel: string
  takes: Record<string, { voicedSeconds: number; pitchHz: number | null; embedding: string | null }>
}

const encode = (embedding: Float32Array): string => Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength).toString('base64')
const decode = (base64: string): Float32Array => {
  const bytes = Buffer.from(base64, 'base64')
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

/**
 * The analysis of every sentence of a synthesis run, kept beside its result file in `analysis.json` and made
 * again only when it was made with another speaker model or another version of the analysis. Embedding and
 * pitch take most of the time of a listening page: 40 runs of 20 sentences took 5 minutes (2026-10-01, M5).
 */
export function analyzeRun(file: string, embedder: { model: { id: string }; embed(pcm: Pcm): Float32Array }): Record<string, TakeAnalysis> {
  const stored = path.join(path.dirname(file), 'analysis.json')
  if (fs.existsSync(stored)) {
    const kept = JSON.parse(fs.readFileSync(stored, 'utf8')) as StoredAnalysis
    if (kept.version === ANALYSIS_VERSION && kept.speakerModel === embedder.model.id) {
      return Object.fromEntries(Object.entries(kept.takes).map(([id, take]) => [id, { ...take, embedding: take.embedding === null ? null : decode(take.embedding) }]))
    }
  }
  const parsed = parseResultFile(fs.readFileSync(file, 'utf8').split('\n'))
  if (!('sentences' in parsed)) throw new Error(`${file} is not a speech synthesis run`)
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
