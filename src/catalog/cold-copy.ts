import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../core/paths.ts'
import { platformKey } from '../core/platform.ts'

/**
 * Model files read from copies that no file cache holds, so that a runtime's load time is that of a model read from
 * the disk, without administrator rights to empty the cache. On macOS a copy is an APFS clone, `cp -c`, which writes
 * no data and is a new file to the cache: a clone of a 2.1 GB file that had just been read took 0.31 s to read the
 * first time, as an unread file did, and 0.14 s the second (Apple M5, 2026-10-13). On Windows it is `robocopy /J`,
 * which copies without the cache. `purge` needs administrator rights.
 */
export interface ColdCopies {
  /** The copies, in the order of the files given. */
  files: string[]
  remove(): void
}

/** The folder the files' paths share, below which each copy keeps its place, as a model read from a folder needs. */
export function commonFolder(files: readonly string[]): string {
  const [first, ...rest] = files.map((file) => path.dirname(path.resolve(file)))
  if (first === undefined) throw new Error('there are no model files to copy')
  let common = first
  while (!rest.every((folder) => folder === common || folder.startsWith(common + path.sep))) {
    const parent = path.dirname(common)
    if (parent === common) throw new Error(`the model files share no folder: ${files.join(', ')}`)
    common = parent
  }
  return common
}

function copyCold(source: string, target: string): void {
  const platform = platformKey()
  if (platform === 'linux-x64') throw new Error('a cold load is measured on macOS and Windows; on Linux, measure the load as the system finds the files')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (platform === 'darwin-arm64') {
    const copied = spawnSync('cp', ['-c', source, target], { encoding: 'utf8', windowsHide: true })
    if (copied.status !== 0) throw new Error(`cp -c could not clone ${source} (${copied.stderr.trim()}); a cold load needs the model files on the APFS volume of the data folder`)
    return
  }
  // robocopy exits with 1 when it copied a file, 0 when it copied none, and 8 or more when it failed.
  const copied = spawnSync('robocopy', [path.dirname(source), path.dirname(target), path.basename(source), '/J', '/R:0', '/NJH', '/NJS', '/NP'], { encoding: 'utf8', windowsHide: true })
  if (copied.status !== 1) throw new Error(`robocopy /J could not copy ${source} (exit code ${String(copied.status)}): ${copied.stdout.trim()}`)
}

/** Copies the files into a folder of their own in the data folder, on the volume they are read from. */
export function coldCopies(files: readonly string[]): ColdCopies {
  const root = commonFolder(files)
  const folder = path.join(dataDir(), 'cold', randomUUID())
  const remove = (): void => fs.rmSync(folder, { recursive: true, force: true })
  try {
    const copies = files.map((file) => {
      const target = path.join(folder, path.relative(root, path.resolve(file)))
      copyCold(path.resolve(file), target)
      if (fs.statSync(target).size !== fs.statSync(file).size) throw new Error(`the copy of ${file} is not the size of the file`)
      return target
    })
    return { files: copies, remove }
  } catch (error) {
    remove()
    throw error
  }
}
