import fs from 'node:fs'
import path from 'node:path'
import { recordingsDir } from '../paths.ts'
import { readWav } from '../wav.ts'
import type { UtteranceSet } from './item.ts'

/**
 * One recording of a speaker: `<data>/recordings/<locale>/<speaker>/manifest.jsonl`, one JSON object per line
 * with `id`, `audio` (a WAV file relative to the manifest) and `text` (what was said).
 */
export interface RecordingEntry {
  id: string
  audio: string
  text: string
}

/** The recordings of one speaker in one locale, kept apart from every other speaker's. */
export interface RecordingFolder {
  locale: string
  speaker: string
}

/** A recording id or a speaker names a file or a folder, so it is kept to characters every file system accepts. */
export const isSafeName = (name: string): boolean => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)

function folderOf({ locale, speaker }: RecordingFolder): string {
  if (!isSafeName(speaker)) throw new Error(`speaker ${JSON.stringify(speaker)} is not lower-case letters, digits, - and _`)
  return path.join(recordingsDir(), locale, speaker)
}

const manifestOf = (folder: RecordingFolder): string => path.join(folderOf(folder), 'manifest.jsonl')

/** The WAV file of a recording. */
export const recordingFile = (folder: RecordingFolder, entry: RecordingEntry): string => path.join(folderOf(folder), entry.audio)

export function readManifest(folder: RecordingFolder): RecordingEntry[] {
  const manifest = manifestOf(folder)
  if (!fs.existsSync(manifest)) return []
  return fs.readFileSync(manifest, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line, index) => {
    const entry = JSON.parse(line) as { id?: unknown; audio?: unknown; text?: unknown }
    if (typeof entry.id !== 'string' || typeof entry.audio !== 'string' || typeof entry.text !== 'string') {
      throw new Error(`${manifest} line ${index + 1} needs the strings id, audio and text`)
    }
    return { id: entry.id, audio: entry.audio, text: entry.text }
  })
}

export function recordingSet(folder: RecordingFolder): UtteranceSet {
  const { locale, speaker } = folder
  const entries = readManifest(folder)
  if (entries.length === 0) throw new Error(`no recordings of ${speaker} in ${locale}: record some with "node src/cli.ts record --locale ${locale} --speaker ${speaker}"`)
  return {
    name: `recordings-${locale}-${speaker}-${entries.length}`,
    locale,
    utterances: entries.map((entry) => ({ id: entry.id, audio: recordingFile(folder, entry), reference: entry.text }))
  }
}

/**
 * Saves a 16 kHz recording and its text, replacing an earlier recording of the same id. The manifest is
 * written to a temporary name and renamed, so an interrupted save leaves the previous manifest whole.
 */
export function saveRecording(folder: RecordingFolder, id: string, text: string, wav: Buffer): RecordingEntry {
  if (!isSafeName(id)) throw new Error(`recording id ${JSON.stringify(id)} is not lower-case letters, digits, - and _`)
  if (text.trim() === '') throw new Error('a recording needs the text that was said')
  const { sampleRate } = readWav(wav)
  if (sampleRate !== 16_000) throw new Error(`a recording is 16 kHz, not ${sampleRate} Hz`)
  fs.mkdirSync(folderOf(folder), { recursive: true })
  const entry: RecordingEntry = { id, audio: `${id}.wav`, text: text.trim() }
  fs.writeFileSync(recordingFile(folder, entry), wav)
  const entries = [...readManifest(folder).filter((existing) => existing.id !== id), entry]
  const manifest = manifestOf(folder)
  fs.writeFileSync(`${manifest}.partial`, entries.map((existing) => JSON.stringify(existing)).join('\n') + '\n')
  fs.renameSync(`${manifest}.partial`, manifest)
  return entry
}
