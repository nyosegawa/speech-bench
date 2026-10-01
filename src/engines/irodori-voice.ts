import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { voiceFilesDir } from '../core/paths.ts'

const run = promisify(execFile)

/**
 * The Irodori-TTS voice file of a reference WAVE file, made once on the CPU with speech.cpp's `irodori-tts
 * --make-voice` and kept by the sha256 of the reference and of the codec it was encoded with: a voice file
 * holds the codec's latent of the reference, and a worker refuses one made with another codec.
 */
export async function irodoriVoiceFile(tool: string, model: string, codec: string, codecSha256: string, reference: { file: string; sha256: string }): Promise<string> {
  const target = path.join(voiceFilesDir(), `${reference.sha256.slice(0, 16)}-${codecSha256.slice(0, 16)}.voice.gguf`)
  if (fs.existsSync(target)) return target
  fs.mkdirSync(voiceFilesDir(), { recursive: true })
  const partial = `${target}.partial`
  try {
    await run(tool, ['--make-voice', model, codec, reference.file, partial, '--device', 'cpu'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  } catch (error) {
    fs.rmSync(partial, { force: true })
    const output = error instanceof Error && 'stderr' in error ? String((error as { stderr: unknown }).stderr).trim() : ''
    throw new Error(`irodori-tts could not make a voice file of ${reference.file}: ${output || (error instanceof Error ? error.message : String(error))}`, { cause: error })
  }
  fs.renameSync(partial, target)
  return target
}
