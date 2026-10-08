import fs from 'node:fs'
import path from 'node:path'
import { sha256Of } from './download.ts'
import type { ModelFile } from './model-file.ts'

/**
 * A model file on this machine that is not published yet, such as a weight type speech.cpp makes for its next release,
 * named by its sha256 and run in place of a catalog entry's pinned file.
 */
export interface LocalFile {
  kind: 'local'
  path: string
  file: string
  bytes: number
  sha256: string
}

/** The file at `file` as the one of this sha256, which is checked whenever it is used. */
export function localFile(file: string, sha256: string): LocalFile {
  const resolved = path.resolve(file)
  const stat = fs.statSync(resolved, { throwIfNoEntry: false })
  if (!stat?.isFile()) throw new Error(`${resolved} is not a file`)
  const hash = sha256.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`${JSON.stringify(sha256)} is not a sha256 of ${resolved}; give the 64 hexadecimal digits that shasum -a 256, or Get-FileHash on Windows, prints for it`)
  return { kind: 'local', path: resolved, file: path.basename(resolved), bytes: stat.size, sha256: hash }
}

/** The path of a local file, once its size and sha256 are still the ones it is named by. */
export async function ensureLocalFile(local: LocalFile): Promise<string> {
  const bytes = fs.statSync(local.path, { throwIfNoEntry: false })?.size
  if (bytes !== local.bytes) throw new Error(`${local.path} is ${bytes === undefined ? 'gone' : `${bytes} bytes`}, not the ${local.bytes} bytes it had when it was named`)
  const sha256 = await sha256Of(local.path)
  if (sha256 !== local.sha256) throw new Error(`${local.path} has sha256 ${sha256}, not the ${local.sha256} it is named by; name the file you mean to measure by its own sha256`)
  return local.path
}

/**
 * The catalog entry with the local file in place of its one file, under an id and a label of their own, so that its
 * runs are never taken for those of the published file. The rest of the entry, its runtime, its decoding or steps and
 * its languages, stays as it is.
 */
export function withLocalFile<M extends { id: string; label: string; files: readonly ModelFile[] }>(model: M, local: LocalFile): M {
  if (model.files.length !== 1) throw new Error(`${model.id} runs on ${model.files.length} files; a local file takes the place of a model's one file`)
  return { ...model, id: `${model.id}-local-${local.sha256.slice(0, 12)}`, label: `local ${local.file} as ${model.id}`, files: [local] }
}
