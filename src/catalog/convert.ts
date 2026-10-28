import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../core/paths.ts'
import { ensureCheckout, run } from './checkout.ts'
import { sha256Of } from './download.ts'
import { BUILD_JOBS } from './source-build.ts'
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
  /** The submodules the converter reads, checked out at the commits the repository pins. */
  submodules: readonly string[]
}

/**
 * A checkpoint published as several files of one repository at one revision, which the converter reads as one folder.
 * The folder is named `name`, which a converter may write into the file as the model's name.
 */
export interface CheckpointFolder {
  kind: 'folder'
  name: string
  files: readonly PinnedFile[]
}

/**
 * One file a conversion writes, pinned by its size and by the sha256 the conversion made on each platform
 * (`darwin-arm64`, `win32-x64`). NeMo-Speech.cpp's converter computes the positional encoding with torch and the mel
 * filterbank with librosa, which round a last bit otherwise on another processor: the same checkpoints made files of
 * the same size and other bytes on an Apple M5 and on an Intel Windows machine (2026-10-08).
 */
export interface ConversionOutput {
  file: string
  bytes: number
  sha256: Readonly<Record<string, string>>
}

/**
 * A pinned checkpoint converted by a pinned converter with `args` after the checkpoint and the output file: the file
 * it is told to write (`--outfile`) first, then those it writes beside it, which a runtime loads from the same folder.
 */
export interface Conversion {
  converter: Converter
  checkpoint: PinnedFile | CheckpointFolder
  args: readonly string[]
  outputs: readonly [ConversionOutput, ...ConversionOutput[]]
  /**
   * The free disk space the conversion needs at its peak beside the checkpoint, for what it writes on the way and the
   * files it keeps, where that is more than the files themselves.
   */
  room?: number
}

/** A model file that no one publishes: one of the files a conversion writes. */
export interface ConvertedFile {
  kind: 'converted'
  conversion: Conversion
  file: string
}

/** The model files of a conversion, one for each file it writes, in its order. */
export const convertedFiles = (conversion: Conversion): ConvertedFile[] =>
  conversion.outputs.map((output) => ({ kind: 'converted', conversion, file: output.file }))

/** This machine's platform as the pins of converted files name it: Node's system and processor, `darwin-arm64`. */
export const platform = (): string => `${process.platform}-${process.arch}`

/** The repository and revision a checkpoint was published at, which a result records. */
export function checkpointOrigin(checkpoint: PinnedFile | CheckpointFolder): { repo: string; revision: string } {
  const [first, ...rest] = checkpoint.kind === 'folder' ? checkpoint.files : [checkpoint]
  if (!first) throw new Error(`the checkpoint folder ${checkpoint.kind === 'folder' ? checkpoint.name : ''} has no files`)
  if (rest.some((file) => file.repo !== first.repo || file.revision !== first.revision)) throw new Error(`the files of the checkpoint ${first.repo} are not all from ${first.repo} at ${first.revision}`)
  return { repo: first.repo, revision: first.revision }
}

const outputOf = (converted: ConvertedFile): ConversionOutput => {
  const output = converted.conversion.outputs.find((candidate) => candidate.file === converted.file)
  if (!output) throw new Error(`${converted.file} is not one of the files the conversion of ${checkpointOrigin(converted.conversion.checkpoint).repo} writes`)
  return output
}

const pinnedSha256 = (output: ConversionOutput): string | undefined => output.sha256[platform()]

/** The sha256 a converted file is pinned by on this platform. */
export function convertedSha256(converted: ConvertedFile): string {
  const output = outputOf(converted)
  const sha256 = pinnedSha256(output)
  if (sha256 === undefined) throw new Error(`${output.file} is pinned for ${Object.keys(output.sha256).join(' and ')}, not for ${platform()}; convert it here once and pin the sha256 it makes`)
  return sha256
}

const projectOf = (converter: Converter): string => path.join(import.meta.dirname, '..', '..', 'converters', converter.id)
const convertersDir = (): string => path.join(dataDir(), 'converters')

const conversionsDir = (conversion: Conversion): string =>
  path.join(dataDir(), 'converted', `${conversion.converter.id}-${conversion.converter.commit.slice(0, 12)}`)

/**
 * Where the files of a conversion are kept: one folder per converter and commit, and in it one per sha256 that this
 * platform pins for the file the converter is told to write, into which only files of the pinned bytes are moved, so
 * that a file made on another platform is never taken for one of them.
 */
const outputsDir = (conversion: Conversion): string =>
  path.join(conversionsDir(conversion), convertedSha256({ kind: 'converted', conversion, file: conversion.outputs[0].file }).slice(0, 16))

/** Where a converted file is kept, beside the other files of its conversion. */
export const convertedPath = (converted: ConvertedFile): string => {
  convertedSha256(converted)
  return path.join(outputsDir(converted.conversion), converted.file)
}

/** The bytes a process may still write on the disk that holds `folder`. */
const freeBytes = (folder: string): number => {
  const stats = fs.statfsSync(folder)
  return stats.bavail * stats.bsize
}

/**
 * The checkpoint as the converter is given it: the path of a single file, or a folder of the checkpoint's name in
 * `work` holding a hard link to each of its files at its path in the repository, downloaded and verified first.
 */
async function checkpointPath(checkpoint: PinnedFile | CheckpointFolder, work: string): Promise<string> {
  if (checkpoint.kind !== 'folder') return ensurePinned(checkpoint)
  const folder = path.join(work, checkpoint.name)
  for (const file of checkpoint.files) {
    const source = await ensurePinned(file)
    const link = path.join(folder, ...file.file.split('/'))
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.linkSync(source, link)
  }
  return folder
}

/**
 * The model file, converted from its checkpoint when it is not there: the checkpoint downloaded and verified, the
 * converter fetched at its commit, its packages installed from the lock file, and the files of the conversion renamed
 * into place only when each has its pinned size and sha256.
 */
export async function ensureConverted(converted: ConvertedFile): Promise<string> {
  const { conversion } = converted
  outputOf(converted)
  const pinned = conversion.outputs.every((output) => pinnedSha256(output) !== undefined)
  const target = pinned ? convertedPath(converted) : null
  if (target !== null && fs.existsSync(target)) return target
  const { repo } = checkpointOrigin(conversion.checkpoint)
  fs.mkdirSync(conversionsDir(conversion), { recursive: true })
  const room = conversion.room ?? conversion.outputs.reduce((sum, output) => sum + output.bytes, 0)
  const free = freeBytes(conversionsDir(conversion))
  if (free < room) throw new Error(`converting ${repo} needs ${(room / 1e9).toFixed(0)} GB free on the disk of ${dataDir()}, and it has ${(free / 1e9).toFixed(0)} GB; free that much, or run the conversion where there is room`)
  const { converter } = conversion
  const source = ensureCheckout(converter.repository, converter.commit, converter.submodules, path.join(convertersDir(), `${converter.id}-${converter.commit}`))
  const env = { UV_PROJECT_ENVIRONMENT: path.join(convertersDir(), `${converter.id}-environment`) }
  process.stderr.write(`  installing the Python packages of the ${converter.id} converter, once\n`)
  run('uv', ['sync', '--frozen', '--project', projectOf(converter)], { env })
  process.stderr.write(`  converting ${repo} to ${conversion.outputs.map((output) => output.file).join(' and ')} with ${converter.id} ${converter.commit.slice(0, 12)}\n`)
  const work = fs.mkdtempSync(path.join(conversionsDir(conversion), '.work-'))
  try {
    const checkpoint = await checkpointPath(conversion.checkpoint, work)
    const made = path.join(work, 'made')
    fs.mkdirSync(made)
    // NeMo-Speech.cpp's converter writes the output's file name without its extension into the file as its model's
    // name when the checkpoint names none, so the file is made under the name it keeps. Hugging Face's libraries are
    // kept offline, so that a file the converter would fetch by repository name stops it instead. Its speech-LLM
    // conversion builds llama-quantize with `cmake --build --parallel` and no number of jobs, which CMake then takes
    // from CMAKE_BUILD_PARALLEL_LEVEL.
    const settings = { ...env, HF_HUB_OFFLINE: '1', CMAKE_BUILD_PARALLEL_LEVEL: String(BUILD_JOBS) }
    run('uv', ['run', '--no-sync', '--project', projectOf(converter), 'python', path.join(source, converter.script), checkpoint, '--outfile', path.join(made, conversion.outputs[0].file), ...conversion.args], { cwd: source, env: settings, shown: true })
    const faults: string[] = []
    let first: string | null = null
    for (const output of conversion.outputs) {
      const file = path.join(made, output.file)
      if (!fs.existsSync(file)) throw new Error(`converting ${repo} with ${converter.id} ${converter.commit.slice(0, 12)} did not write ${output.file}; it wrote ${fs.readdirSync(made).join(', ') || 'nothing'}`)
      const bytes = fs.statSync(file).size
      const sha256 = await sha256Of(file)
      first ??= sha256
      const expected = pinnedSha256(output)
      if (bytes !== output.bytes || sha256 !== expected) faults.push(`${output.file} of ${bytes} bytes with sha256 ${sha256}${expected === undefined ? '' : `, not the ${output.bytes} bytes with ${expected} pinned for ${platform()}`}`)
    }
    const conversionMade = `converting ${repo} with ${converter.id} ${converter.commit.slice(0, 12)} made ${faults.join('; ')}`
    // A conversion no platform's pin covers yet is kept where the bench looks for it once these sha256 are pinned, so
    // that a long one is not made twice, as Nemotron 3.5 Transcribe's took 16 minutes on an Apple M5 (2026-10-29); a
    // file that differs from its pin is removed.
    if (!pinned && first !== null) {
      const kept = path.join(conversionsDir(conversion), first.slice(0, 16))
      fs.mkdirSync(kept, { recursive: true })
      for (const output of conversion.outputs) fs.renameSync(path.join(made, output.file), path.join(kept, output.file))
      throw new Error(`${conversionMade}, and no sha256 is pinned for ${platform()}; the files are kept in ${kept}, where the bench takes them once these sizes and sha256 are pinned`)
    }
    if (faults.length > 0) throw new Error(`${conversionMade}; the bench measures only pinned files`)
    const folder = outputsDir(conversion)
    fs.mkdirSync(folder, { recursive: true })
    for (const output of conversion.outputs) fs.renameSync(path.join(made, output.file), path.join(folder, output.file))
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
  return convertedPath(converted)
}
