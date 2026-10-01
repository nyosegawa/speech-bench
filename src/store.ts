import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.ts'
import { downloadVerified } from './download.ts'

/** A file on Hugging Face pinned to one revision and verified by its size and sha256. */
export interface PinnedFile {
  kind: 'model' | 'dataset'
  repo: string
  revision: string
  file: string
  bytes: number
  sha256: string
}

export const huggingFaceUrl = (pinned: PinnedFile): string =>
  `https://huggingface.co/${pinned.kind === 'dataset' ? 'datasets/' : ''}${pinned.repo}/resolve/${pinned.revision}/${pinned.file}`

/** Where a pinned file lives: one folder per repository and revision. */
export function storePath(pinned: PinnedFile): string {
  return path.join(dataDir(), `${pinned.kind}s`, pinned.repo.replace('/', '--'), pinned.revision, pinned.file)
}

/** The local path of a pinned file, downloading it first when it is not there. */
export async function ensurePinned(pinned: PinnedFile): Promise<string> {
  const target = storePath(pinned)
  if (fs.existsSync(target)) return target
  process.stderr.write(`  downloading ${pinned.repo}/${pinned.file} (${(pinned.bytes / 1e6).toFixed(0)} MB)\n`)
  await downloadVerified(huggingFaceUrl(pinned), target, pinned.sha256)
  return target
}
