import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../core/paths.ts'
import { sha256Of } from './download.ts'
import { ensurePinned, type PinnedFile } from './store.ts'

/**
 * A converter in a repository of its own, pinned to a commit, run with the packages that the uv project
 * `converters/<id>/` of this repository locks.
 */
export interface Converter {
  id: string
  repository: string
  commit: string
  /** The script in the repository that takes a checkpoint and `--outfile`. */
  script: string
}

/**
 * A model file that no one publishes, made from a pinned checkpoint by a pinned converter, and pinned in turn by its
 * size and sha256 as the conversion made it on an Apple M5.
 */
export interface ConvertedFile {
  kind: 'converted'
  converter: Converter
  checkpoint: PinnedFile
  /** The converter's arguments after the checkpoint and the output file. */
  args: readonly string[]
  file: string
  bytes: number
  sha256: string
}

/** A model file the bench downloads as it is, or makes from a checkpoint. */
export type ModelFile = PinnedFile | ConvertedFile

const projectOf = (converter: Converter): string => path.join(import.meta.dirname, '..', '..', 'converters', converter.id)
const convertersDir = (): string => path.join(dataDir(), 'converters')

/** Where a converted file is kept: one folder per converter and commit. */
export const convertedPath = (converted: ConvertedFile): string =>
  path.join(dataDir(), 'converted', `${converted.converter.id}-${converted.converter.commit.slice(0, 12)}`, converted.file)

/** Runs a command to its end and returns its stdout, failing with what it wrote. */
function run(command: string, args: readonly string[], options: { cwd?: string; env?: Readonly<Record<string, string>> } = {}): string {
  const result = spawnSync(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  if (result.error) throw new Error(`${command} could not be started (${result.error.message}); install it and run the command again`, { cause: result.error })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

/**
 * The converter's repository at its commit, fetched once with git, which checks what it fetched against the commit's
 * hash. The folder is renamed into place only once checked out.
 */
function ensureConverterSource(converter: Converter): string {
  const folder = path.join(convertersDir(), `${converter.id}-${converter.commit}`)
  if (fs.existsSync(folder)) return folder
  process.stderr.write(`  fetching ${converter.repository} at ${converter.commit.slice(0, 12)}\n`)
  fs.mkdirSync(convertersDir(), { recursive: true })
  const work = fs.mkdtempSync(path.join(convertersDir(), '.work-'))
  try {
    const checkout = path.join(work, 'source')
    // The converter needs none of the files kept in Git LFS, which a checkout would otherwise download.
    const env = { GIT_LFS_SKIP_SMUDGE: '1' }
    run('git', ['init', '-q', checkout], { env })
    run('git', ['-C', checkout, 'fetch', '-q', '--depth', '1', converter.repository, converter.commit], { env })
    run('git', ['-C', checkout, 'checkout', '-q', '--detach', 'FETCH_HEAD'], { env })
    const head = run('git', ['-C', checkout, 'rev-parse', 'HEAD'])
    if (head !== converter.commit) throw new Error(`fetching ${converter.commit} of ${converter.repository} checked out ${head}`)
    fs.renameSync(checkout, folder)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
  return folder
}

/**
 * The model file, converted from its checkpoint when it is not there: the checkpoint downloaded and verified, the
 * converter fetched at its commit, its packages installed from the lock file, and the file renamed into place only
 * when its size and sha256 are the pinned ones.
 */
export async function ensureConverted(converted: ConvertedFile): Promise<string> {
  const target = convertedPath(converted)
  if (fs.existsSync(target)) return target
  const { converter } = converted
  const checkpoint = await ensurePinned(converted.checkpoint)
  const source = ensureConverterSource(converter)
  const env = { UV_PROJECT_ENVIRONMENT: path.join(convertersDir(), `${converter.id}-environment`) }
  process.stderr.write(`  installing the Python packages of the ${converter.id} converter, once\n`)
  run('uv', ['sync', '--frozen', '--project', projectOf(converter)], { env })
  process.stderr.write(`  converting ${converted.checkpoint.repo} to ${converted.file} with ${converter.id} ${converter.commit.slice(0, 12)}\n`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const work = fs.mkdtempSync(path.join(path.dirname(target), '.work-'))
  try {
    // NeMo-Speech.cpp's converter writes the output's file name without its extension into the file as its model's
    // name when the checkpoint names none, so the file is made under the name it keeps.
    const output = path.join(work, converted.file)
    run('uv', ['run', '--frozen', '--no-sync', '--project', projectOf(converter), 'python', path.join(source, converter.script), checkpoint, '--outfile', output, ...converted.args], { cwd: source, env })
    const bytes = fs.statSync(output).size
    const sha256 = await sha256Of(output)
    // The converter computes the positional encoding with torch and the mel filterbank with librosa, which can round
    // the last bit otherwise on another processor than the Apple M5 the hashes were pinned on.
    if (bytes !== converted.bytes || sha256 !== converted.sha256) {
      throw new Error(`converting ${checkpoint} with ${converter.id} ${converter.commit.slice(0, 12)} made ${converted.file} of ${bytes} bytes with sha256 ${sha256}, not the pinned ${converted.bytes} bytes with ${converted.sha256}; the bench measures only the pinned file, which can be copied to ${target} from a machine that made it`)
    }
    fs.renameSync(output, target)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
  return target
}

/** The local path of a model file, downloading or converting it first when it is not there. */
export const ensureModelFile = (file: ModelFile): Promise<string> => (file.kind === 'converted' ? ensureConverted(file) : ensurePinned(file))
