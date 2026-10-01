import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { SPEAKER_MODEL } from '../catalog/models.ts'
import { SpeakerEmbedder } from '../engines/speaker-embedding.ts'
import { isSafeName } from '../datasets/recordings.ts'
import { pagesDir } from '../core/paths.ts'
import { latestRuns, readTtsRuns, relativeTo } from '../pages/listen.ts'
import { embedGroups, neighborGroups, neighborsPage } from '../analysis/neighbors.ts'
import { referenceFile, referenceManifest } from '../make/references.ts'
import { voicesData, voicesPage } from '../pages/voices.ts'
import { readWav } from '../core/wav.ts'
import { runFilesOf } from './measure.ts'

/** The speaker embedding of each reference voice by name, embedded once. */
function referenceEmbeddings(embedder: SpeakerEmbedder): (name: string) => Float32Array {
  const embeddings = new Map<string, Float32Array>()
  return (name) => {
    const known = embeddings.get(name) ?? embedder.embed(readWav(fs.readFileSync(referenceFile(name))))
    embeddings.set(name, known)
    return known
  }
}

export async function voices(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { page: { type: 'string' }, campaign: { type: 'string' } } })
  if (values.page !== undefined && !isSafeName(values.page)) throw new Error('--page names the page in lower-case letters, digits, - and _')
  const embedder = await SpeakerEmbedder.open(SPEAKER_MODEL)
  const embeddingOf = referenceEmbeddings(embedder)
  const runs = latestRuns(readTtsRuns(runFilesOf(positionals, values.campaign), embedder, (run) => run.reference !== null, (run) => embeddingOf(run.reference!.name)))
  if (runs.length === 0) throw new Error('there are no runs that spoke like a reference voice; run "node src/cli.ts tts --reference name" first')
  const name = values.page ?? 'voices'
  const page = path.join(pagesDir(), `voices-${name}.html`)
  fs.mkdirSync(pagesDir(), { recursive: true })
  fs.writeFileSync(page, voicesPage(voicesData(runs, (reference) => ({ manifest: referenceManifest(reference), file: referenceFile(reference) }), relativeTo(page), name)))
  console.log(page)
}

export async function neighbors(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { page: { type: 'string' }, campaign: { type: 'string' } } })
  if (values.page !== undefined && !isSafeName(values.page)) throw new Error('--page names the page in lower-case letters, digits, - and _')
  const page = path.join(pagesDir(), `neighbors-${values.page ?? 'voices'}.html`)
  fs.mkdirSync(pagesDir(), { recursive: true })
  const groups = neighborGroups(embedGroups(runFilesOf(positionals, values.campaign), await SpeakerEmbedder.open(SPEAKER_MODEL)), relativeTo(page))
  if (groups.length === 0) throw new Error('there are no synthesized voices with two or more sentences long enough to compare; run "node src/cli.ts tts" first')
  fs.writeFileSync(page, neighborsPage(groups))
  console.log(page)
}
