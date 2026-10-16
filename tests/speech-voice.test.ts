import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { speechVoiceFile } from '../src/engines/speech-voice.ts'

/**
 * A shell script stands in for speech: `info` prints info.json beside it, and `voice` writes its arguments to
 * voice-args.txt and creates the file it is given before `--device`.
 */
const FAKE_SPEECH = `#!/bin/sh
here=$(dirname "$0")
if [ "$1" = info ]; then cat "$here/info.json"; exit 0; fi
printf '%s\\n' "$@" > "$here/voice-args.txt"
previous=
for argument in "$@"; do
  if [ "$argument" = --device ]; then : > "$previous"; fi
  previous=$argument
done
`

describe.skipIf(process.platform === 'win32')('speechVoiceFile', () => {
  let folder: string
  let saved: string | undefined
  const reference = { file: 'reference.wav', sha256: 'ab'.repeat(32), transcript: '一つ目の文です。 二つ目の文です。' }
  const tool = (): { executable: string; version: string } => ({ executable: path.join(folder, 'speech'), version: '0.8.8' })
  const info = (fields: Record<string, unknown>): void => {
    fs.writeFileSync(path.join(folder, 'info.json'), JSON.stringify({ voice_files: true, voice_codec: 'cd'.repeat(32), ...fields }))
  }
  const voiceArgs = (): string[] => fs.readFileSync(path.join(folder, 'voice-args.txt'), 'utf8').trimEnd().split('\n')

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-voice-'))
    fs.writeFileSync(path.join(folder, 'speech'), FAKE_SPEECH, { mode: 0o755 })
    saved = process.env.SPEECH_BENCH_DATA
    process.env.SPEECH_BENCH_DATA = path.join(folder, 'data')
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.SPEECH_BENCH_DATA
    else process.env.SPEECH_BENCH_DATA = saved
    fs.rmSync(folder, { recursive: true, force: true })
  })

  it('gives the words of the reference to a model that makes no voice from recordings alone, and says so', async () => {
    info({ voice_recordings: false })
    const made = await speechVoiceFile(tool(), 'drama3.gguf', reference)
    expect(voiceArgs().slice(0, 5)).toEqual(['voice', 'drama3.gguf', 'reference.wav', '--transcript', reference.transcript])
    expect(made.transcript).toBe(reference.transcript)
    expect(fs.existsSync(made.file)).toBe(true)
  })

  it('gives no words to a model that makes a voice from recordings alone, or whose release does not say', async () => {
    for (const fields of [{ voice_recordings: true }, {}]) {
      info(fields)
      fs.rmSync(path.join(folder, 'data'), { recursive: true, force: true })
      const made = await speechVoiceFile(tool(), 'irodori.gguf', reference)
      expect(voiceArgs()).not.toContain('--transcript')
      expect(made.transcript).toBeNull()
    }
  })

  it('refuses a model that takes no voice files', async () => {
    fs.writeFileSync(path.join(folder, 'info.json'), JSON.stringify({ voice_files: false }))
    await expect(speechVoiceFile(tool(), 'qwen3-tts.gguf', reference)).rejects.toThrow(/takes no voice files/)
  })
})
