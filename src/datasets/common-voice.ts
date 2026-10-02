import fs from 'node:fs'
import path from 'node:path'
import { ensureLibrary, HYPARQUET, MPG123_DECODER } from '../catalog/runtimes.ts'
import { ensurePinned, type PinnedFile } from '../catalog/store.ts'
import { dataDir } from '../core/paths.ts'
import { encodeWav16, resample, type Pcm } from '../core/wav.ts'
import type { UtteranceSet } from './item.ts'

/**
 * The test split of Common Voice 8.0 (CC0), which Japanese models report their rates on. Mozilla no longer hands out
 * old versions openly, to honour speakers who withdrew their consent, so it is read from a copy on Hugging Face: one
 * Parquet file with each clip's file name, its MP3 at 48 or 32 kHz, and its sentence.
 */
const TEST_SPLITS: Readonly<Record<string, { config: string; parquet: PinnedFile }>> = {
  'ja-JP': {
    config: 'ja',
    parquet: {
      kind: 'dataset',
      repo: 'japanese-asr/ja_asr.common_voice_8_0',
      revision: 'bf8819e8d9a5feb51b0c718686bd20ea67a3c729',
      file: 'data/test-00000-of-00001.parquet',
      bytes: 151_322_876,
      sha256: '44a9141bc16cfa34877955fb39003ad34d3b730417a05c9eb50d8e90ba3ec40a'
    }
  }
}

export const commonVoiceLocales = (): string[] => Object.keys(TEST_SPLITS)

interface Hyparquet {
  parquetReadObjects: (options: { file: ArrayBuffer; columns: string[]; utf8: boolean }) => Promise<Array<Record<string, unknown>>>
}

interface MpegDecoder {
  ready: Promise<void>
  decode: (data: Uint8Array) => { channelData: Float32Array[]; samplesDecoded: number; sampleRate: number; errors: unknown[] }
  reset: () => Promise<void>
  free: () => void
}

/** One clip of the split: its file name, its sentence, and its MP3 when asked for. */
interface Clip {
  clip: string
  sentence: string
  mp3: Uint8Array | null
}

const splitOf = (locale: string): { config: string; parquet: PinnedFile } => {
  const split = TEST_SPLITS[locale]
  if (!split) throw new Error(`Common Voice 8.0 is pinned for ${commonVoiceLocales().join(', ')}, not ${locale}`)
  return split
}

const text = (value: unknown): string => (typeof value === 'string' ? value : new TextDecoder().decode(value as Uint8Array))

/** The clips of the split in the order of the Parquet file, which the pinned revision fixes. */
async function readClips(locale: string, withAudio: boolean): Promise<Clip[]> {
  const bytes = fs.readFileSync(await ensurePinned(splitOf(locale).parquet))
  const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const { parquetReadObjects } = (await import(await ensureLibrary(HYPARQUET))) as Hyparquet
  // Without utf8: false, hyparquet returns the MP3 bytes as a string.
  const rows = await parquetReadObjects({ file, columns: ['audio', 'transcription'], utf8: false })
  return rows.map((row) => {
    const audio = row.audio as { path: unknown; bytes: unknown }
    return { clip: text(audio.path), sentence: text(row.transcription), mp3: withAudio ? (audio.bytes as Uint8Array) : null }
  })
}

/** The sentences of the test split in its order; each clip has a sentence of its own. */
export async function commonVoiceTestSentences(locale: string): Promise<string[]> {
  return [...new Set((await readClips(locale, false)).map((clip) => clip.sentence))]
}

/** Channels as one, each sample the mean of theirs; the clips of the split are all mono, which mpg123-decoder gives as two equal channels. */
export function mono(channels: readonly Float32Array[], length: number): Float32Array {
  return Float32Array.from({ length }, (_, index) => channels.reduce((sum, channel) => sum + (channel[index] ?? 0), 0) / channels.length)
}

function decoded(decoder: MpegDecoder, clip: Clip): Pcm {
  const result = decoder.decode(clip.mp3!)
  if (result.errors.length > 0 || result.samplesDecoded === 0) throw new Error(`${clip.clip} of Common Voice 8.0 did not decode with mpg123-decoder ${MPG123_DECODER.version}`)
  return { sampleRate: result.sampleRate, samples: mono(result.channelData, result.samplesDecoded) }
}

/**
 * The first `count` clips of the test split, decoded once to 16 kHz WAVE files in the data folder, each written
 * beside its place and renamed into it, so a file that exists is whole.
 */
export async function commonVoiceTestSet(locale: string, count: number): Promise<UtteranceSet> {
  const { config } = splitOf(locale)
  const clips = (await readClips(locale, true)).slice(0, count)
  const folder = path.join(dataDir(), 'common-voice', '8.0', config, 'test')
  const wave = (clip: Clip): string => path.join(folder, `${path.parse(clip.clip).name}.wav`)
  const missing = clips.filter((clip) => !fs.existsSync(wave(clip)))
  if (missing.length > 0) {
    fs.mkdirSync(folder, { recursive: true })
    const { MPEGDecoder } = (await import(await ensureLibrary(MPG123_DECODER))) as { MPEGDecoder: new () => MpegDecoder }
    const decoder = new MPEGDecoder()
    await decoder.ready
    try {
      for (const clip of missing) {
        const temporary = `${wave(clip)}.partial`
        fs.writeFileSync(temporary, encodeWav16(resample(decoded(decoder, clip), 16_000)))
        fs.renameSync(temporary, wave(clip))
        await decoder.reset()
      }
    } finally {
      decoder.free()
    }
  }
  return {
    name: `common-voice-8-${config}-test-${clips.length}`,
    locale,
    utterances: clips.map((clip) => ({ id: clip.clip, audio: wave(clip), reference: clip.sentence }))
  }
}
