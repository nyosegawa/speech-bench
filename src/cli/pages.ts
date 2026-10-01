import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { SPEAKER_MODEL } from '../catalog/models.ts'
import { SpeakerEmbedder } from '../engines/speaker-embedding.ts'
import { isSafeName } from '../datasets/recordings.ts'
import { pagesDir } from '../core/paths.ts'
import { relativeTo } from '../pages/listen.ts'
import { embedGroups, neighborGroups, neighborsPage } from '../analysis/neighbors.ts'
import { runFilesOf } from './measure.ts'

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
