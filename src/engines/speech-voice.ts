import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { voiceFilesDir } from '../core/paths.ts'

const execute = promisify(execFile)

/** speech.cpp's executable and a name of its release or local build, which changes with it. */
export interface Speech {
  executable: string
  version: string
}

/** Runs a subcommand of `speech` and returns its stdout, failing with what it wrote on stderr. */
async function speech(tool: Speech, args: string[], what: string): Promise<string> {
  try {
    return (await execute(tool.executable, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout
  } catch (error) {
    const output = error instanceof Error && 'stderr' in error ? String((error as { stderr: unknown }).stderr).trim() : ''
    throw new Error(`speech could not ${what}: ${output || (error instanceof Error ? error.message : String(error))}`, { cause: error })
  }
}

/**
 * What `speech info` reads from a model file without loading it: the hash of the codec it encodes voices with, and
 * whether it makes a voice from recordings alone or, as Drama 3 does, needs the words each recording says. Releases
 * before 0.8.8 do not say, and every model they make voice files for takes recordings alone.
 */
async function voiceFormOf(tool: Speech, model: string): Promise<{ codec: string; transcript: boolean }> {
  const info = JSON.parse(await speech(tool, ['info', model, '--json'], `read ${model}`)) as Record<string, unknown>
  if (info.voice_files !== true || typeof info.voice_codec !== 'string') throw new Error(`${model} takes no voice files`)
  return { codec: info.voice_codec, transcript: info.voice_recordings === false }
}

/**
 * The voice file of a reference WAVE file, made once on the CPU with speech.cpp's `speech voice`, given the words of
 * the reference's takes for a model that needs them, and kept by the sha256 of the reference, the hash of the codec it
 * holds the codes of, which the model file names and a model of another codec refuses, and the release or local build
 * that made it, since a release may write voice files of a form the ones before it cannot read and refuse theirs, as
 * 0.7.0 does. Returns the file and the transcript it was made with, or null for a model that takes none.
 */
export async function speechVoiceFile(tool: Speech, model: string, reference: { file: string; sha256: string; transcript: string }): Promise<{ file: string; transcript: string | null }> {
  const { codec, transcript } = await voiceFormOf(tool, model)
  const target = path.join(voiceFilesDir(), `${reference.sha256.slice(0, 16)}-${codec.slice(0, 16)}-${tool.version}.voice.gguf`)
  const made = { file: target, transcript: transcript ? reference.transcript : null }
  if (fs.existsSync(target)) return made
  fs.mkdirSync(voiceFilesDir(), { recursive: true })
  const partial = `${target}.partial`
  try {
    const words = transcript ? ['--transcript', reference.transcript] : []
    await speech(tool, ['voice', model, reference.file, ...words, partial, '--device', 'cpu'], `make a voice file of ${reference.file}`)
  } catch (error) {
    fs.rmSync(partial, { force: true })
    throw error
  }
  fs.renameSync(partial, target)
  return made
}
