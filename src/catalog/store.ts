import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dataDir } from '../core/paths.ts'
import { downloadVerified, sha256Of } from './download.ts'

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

/**
 * The folder of Hugging Face's own cache, as its libraries find it: HF_HUB_CACHE, else `hub` in HF_HOME, else
 * `~/.cache/huggingface/hub`.
 */
export function huggingFaceCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const cache = env.HF_HUB_CACHE?.trim()
  if (cache) return path.resolve(cache)
  const home = env.HF_HOME?.trim()
  return home ? path.join(path.resolve(home), 'hub') : path.join(os.homedir(), '.cache', 'huggingface', 'hub')
}

/** Where Hugging Face's cache keeps a file of a repository at a revision named by its commit: a link into its blobs. */
export const huggingFaceCachePath = (pinned: PinnedFile, cache: string): string =>
  path.join(cache, `${pinned.kind}s--${pinned.repo.replace('/', '--')}`, 'snapshots', pinned.revision, ...pinned.file.split('/'))

/**
 * Copies a file as a clone where the file system makes one, which takes no room until one of the two changes: on a Mac
 * with `cp -c`, since Node's COPYFILE_FICLONE copies every byte on APFS (Node 22.23, 2026-10-29), and elsewhere with
 * COPYFILE_FICLONE, which clones on Linux file systems that can and copies on the others.
 */
function cloneFile(source: string, target: string): void {
  if (process.platform !== 'darwin') {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE)
    return
  }
  const cloned = spawnSync('cp', ['-c', source, target], { encoding: 'utf8', windowsHide: true })
  if (cloned.status !== 0) throw new Error(`cp -c could not clone ${source} into the store (${cloned.stderr.trim()}); the store and Hugging Face's cache must be on one APFS volume`)
}

/**
 * Takes a pinned file from Hugging Face's cache into the store when the cache holds it at the pinned revision with the
 * pinned size and sha256, and returns whether it did, as a clone where the file system makes one.
 */
async function takeFromHuggingFaceCache(pinned: PinnedFile, target: string): Promise<boolean> {
  const cached = huggingFaceCachePath(pinned, huggingFaceCacheDir())
  const stat = fs.statSync(cached, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.size !== pinned.bytes) return false
  process.stderr.write(`  checking ${pinned.repo}/${pinned.file} in Hugging Face's cache (${(pinned.bytes / 1e6).toFixed(0)} MB)\n`)
  const sha256 = await sha256Of(cached)
  if (sha256 !== pinned.sha256) throw new Error(`${cached} has sha256 ${sha256}, not the pinned ${pinned.sha256}; remove it from Hugging Face's cache or download the file again with hf download`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const partial = `${target}.partial`
  cloneFile(cached, partial)
  fs.renameSync(partial, target)
  return true
}

/**
 * The local path of a pinned file, taken from Hugging Face's cache or downloaded first when it is not there, so that a
 * checkpoint someone fetched with Hugging Face's tools is never downloaded a second time.
 */
export async function ensurePinned(pinned: PinnedFile): Promise<string> {
  const target = storePath(pinned)
  if (fs.existsSync(target)) return target
  if (await takeFromHuggingFaceCache(pinned, target)) return target
  process.stderr.write(`  downloading ${pinned.repo}/${pinned.file} (${(pinned.bytes / 1e6).toFixed(0)} MB)\n`)
  await downloadVerified(huggingFaceUrl(pinned), target, pinned.sha256)
  return target
}
