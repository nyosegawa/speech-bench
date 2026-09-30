import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dataDir } from './paths.ts'
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

/**
 * Where a pinned file lives: one folder per repository and revision, laid out like ASIST's
 * userData/speech-models so that the files ASIST has prepared can be taken over as they are.
 */
export function storePath(pinned: PinnedFile): string {
  return path.join(dataDir(), `${pinned.kind}s`, pinned.repo.replace('/', '--'), pinned.revision, pinned.file)
}

/** The folders where ASIST keeps the model files it prepared, on this machine's system. */
function asistModelFolders(): string[] {
  if (process.platform === 'darwin') return [path.join(os.homedir(), 'Library', 'Application Support', 'ASIST', 'speech-models')]
  if (process.platform === 'win32' && process.env.APPDATA) return [path.join(process.env.APPDATA, 'asist', 'speech-models')]
  return []
}

/**
 * Takes the file over from ASIST when ASIST has the same pinned file, which spares downloading gigabytes
 * a second time. The copy is verified like a download; a hard link is tried first so that it costs no space.
 */
async function takeOverFromAsist(pinned: PinnedFile, target: string): Promise<boolean> {
  if (pinned.kind !== 'model') return false
  for (const folder of asistModelFolders()) {
    const candidate = path.join(folder, pinned.repo.replace('/', '--'), pinned.revision, pinned.file)
    if (!fs.existsSync(candidate) || fs.statSync(candidate).size !== pinned.bytes) continue
    const actual = await sha256Of(candidate)
    if (actual !== pinned.sha256) throw new Error(`${candidate} has sha256 ${actual}, not the pinned ${pinned.sha256}`)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    try {
      fs.linkSync(candidate, target)
    } catch {
      fs.copyFileSync(candidate, target)
    }
    process.stderr.write(`  ${pinned.file}: taken from ASIST's ${folder}\n`)
    return true
  }
  return false
}

/** The local path of a pinned file, downloading it first when it is not there. */
export async function ensurePinned(pinned: PinnedFile): Promise<string> {
  const target = storePath(pinned)
  if (fs.existsSync(target)) return target
  if (await takeOverFromAsist(pinned, target)) return target
  process.stderr.write(`  downloading ${pinned.repo}/${pinned.file} (${(pinned.bytes / 1e6).toFixed(0)} MB)\n`)
  await downloadVerified(huggingFaceUrl(pinned), target, pinned.sha256)
  return target
}
