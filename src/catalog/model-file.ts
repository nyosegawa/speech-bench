import { ensureConverted, type ConvertedFile } from './convert.ts'
import { ensureLocalFile, type LocalFile } from './local-file.ts'
import { ensurePinned, type PinnedFile } from './store.ts'

/** A model file the bench downloads as it is, makes from a checkpoint, or takes from this machine before it is published. */
export type ModelFile = PinnedFile | ConvertedFile | LocalFile

/** The local path of a model file, downloading or converting it first when it is not there, and checking a local one. */
export function ensureModelFile(file: ModelFile): Promise<string> {
  if (file.kind === 'converted') return ensureConverted(file)
  if (file.kind === 'local') return ensureLocalFile(file)
  return ensurePinned(file)
}
