import type { PinnedFile } from './store.ts'
import { tagCovers } from '../core/language.ts'

/**
 * Where a model runs: llama-server with the language model and its audio projector, or CrispASR with one
 * GGUF and the backend it loads as, which CrispASR's /health reports.
 */
export type AsrRuntime = { runtime: 'llama-server' } | { runtime: 'crispasr'; backend: string }

/** A speech recognition model the bench can run, with the languages its model card lists. */
export type AsrModel = AsrRuntime & {
  id: string
  label: string
  files: readonly PinnedFile[]
  /** BCP 47 tags from the model card. A tag without a region covers every region of the language. */
  languages: readonly string[]
  /**
   * Whether a request can name the language. parakeet-tdt-0.6b-v3 has no way to be told it and detects
   * the language itself, which the bench must not hide by passing one.
   */
  languageHint: 'optional' | 'none'
  license: string
}

const QWEN3_ASR_LANGUAGES = ['zh', 'en', 'yue', 'ar', 'de', 'fr', 'es', 'pt', 'id', 'it', 'ko', 'ru', 'th', 'vi', 'ja', 'tr', 'hi', 'ms', 'nl', 'sv', 'da', 'fi', 'pl', 'cs', 'fil', 'fa', 'el', 'ro', 'hu', 'mk']

const PARAKEET_V3_LANGUAGES = ['bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr', 'hu', 'it', 'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'uk']

const model = (repo: string, revision: string, file: string, bytes: number, sha256: string): PinnedFile =>
  ({ kind: 'model', repo, revision, file, bytes, sha256 })

const QWEN3_ASR_1_7B = ['ggml-org/Qwen3-ASR-1.7B-GGUF', '36a678687ba7d07a74ca70ccb0e36902e005fb80'] as const
const QWEN3_ASR_0_6B = ['ggml-org/Qwen3-ASR-0.6B-GGUF', '928ab958557df9aa2ef1c93e0e83c7ad0933fae2'] as const

/** Qwen3-ASR as ggml-org converts it for llama-server, and the CrispASR conversions of the NeMo models. */
export const ASR_MODELS: readonly AsrModel[] = [
  {
    id: 'qwen3-asr-1.7b',
    label: 'Qwen3-ASR 1.7B Q8_0',
    runtime: 'llama-server',
    files: [
      model(...QWEN3_ASR_1_7B, 'Qwen3-ASR-1.7B-Q8_0.gguf', 2_165_034_944, '58e22d0532d4eacaf034cfac17a6fed159f37c41390c710186783be439d1fc57'),
      model(...QWEN3_ASR_1_7B, 'mmproj-Qwen3-ASR-1.7B-Q8_0.gguf', 355_709_344, '46c1d533af3f354ceb37ce855dbceff7da7fa7cf1e6a523df3b13440bd164c0d')
    ],
    languages: QWEN3_ASR_LANGUAGES,
    languageHint: 'optional',
    license: 'Apache-2.0'
  },
  {
    id: 'qwen3-asr-0.6b',
    label: 'Qwen3-ASR 0.6B Q8_0',
    runtime: 'llama-server',
    files: [
      model(...QWEN3_ASR_0_6B, 'Qwen3-ASR-0.6B-Q8_0.gguf', 804_749_248, 'bca259818b50ca7c4c05e9bdb35a5dc04fa039653a6d6f3f0f331f96f6aa1971'),
      model(...QWEN3_ASR_0_6B, 'mmproj-Qwen3-ASR-0.6B-Q8_0.gguf', 214_392_480, '41a342b5e4c514e968cb756de6cd1b7be39eff43c44c57a2ef5fc6522e36603d')
    ],
    languages: QWEN3_ASR_LANGUAGES,
    languageHint: 'optional',
    license: 'Apache-2.0'
  },
  {
    id: 'parakeet-tdt-0.6b-v3',
    label: 'parakeet-tdt-0.6b-v3 Q8_0',
    runtime: 'crispasr',
    files: [
      model('cstr/parakeet-tdt-0.6b-v3-GGUF', 'dff69b0e675921ffd5a6133f5fbe2aac690d3ec3', 'parakeet-tdt-0.6b-v3-q8_0.gguf', 674_342_336, '300de963db10e991a8c3c1674000245546f2e99d396f860aecbde2dd0534e43f')
    ],
    backend: 'parakeet',
    languages: PARAKEET_V3_LANGUAGES,
    languageHint: 'none',
    license: 'CC-BY-4.0'
  },
  {
    id: 'parakeet-tdt_ctc-0.6b-ja',
    label: 'parakeet-tdt_ctc-0.6b-ja Q8_0',
    runtime: 'crispasr',
    files: [
      model('cstr/parakeet-tdt-0.6b-ja-GGUF', 'd9e3ba65a6579796389ea89e5939509ed257f972', 'parakeet-tdt-0.6b-ja-q8_0.gguf', 673_554_880, '5a61e6c7d956c3c72a76fafcd798cac0c9ea66d0e29b3910cd04865a1e42cc17')
    ],
    backend: 'parakeet',
    languages: ['ja'],
    languageHint: 'none',
    license: 'CC-BY-4.0'
  },
  {
    id: 'reazonspeech-nemo-v2',
    label: 'ReazonSpeech NeMo v2 Q8_0',
    runtime: 'crispasr',
    files: [
      model('cstr/reazonspeech-nemo-v2-GGUF', '22799a5919ea26e3c5293fe0e68846fe7918a234', 'reazonspeech-nemo-v2-q8_0.gguf', 667_147_072, '20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2')
    ],
    backend: 'reazonspeech',
    languages: ['ja'],
    languageHint: 'none',
    license: 'Apache-2.0'
  }
]

export function asrModel(id: string): AsrModel {
  const found = ASR_MODELS.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`unknown model ${id}; the models are ${ASR_MODELS.map((candidate) => candidate.id).join(', ')}`)
  return found
}

export const modelCovers = (model: { languages: readonly string[] }, locale: string): boolean => model.languages.some((tag) => tagCovers(tag, locale))

/** A voice a synthesis model has built in, with the language it was recorded in, where it sounds most natural. */
export interface TtsVoice {
  id: string
  native: string
}

/**
 * Where a synthesis model runs: speech.cpp's worker, with the sampler's steps when not the model's own and
 * whether it speaks like a reference voice, or audio.cpp's server with the family it loads as, the options it
 * is loaded with on each GPU interface, the request options every sentence is sent with, and whether it takes
 * a voice described in words (`instruction`) and a reference voice to speak like.
 */
export type TtsRuntime =
  | { runtime: 'speech-worker'; steps: number | null; voiceReference: boolean }
  | {
      runtime: 'audio.cpp'
      family: string
      loadOptions: Readonly<Partial<Record<'metal' | 'vulkan', Readonly<Record<string, string>>>>>
      options: Readonly<Record<string, unknown>>
      voiceDesign: boolean
      voiceReference: boolean
      /** Whether the model predicts the length of the speech and takes a factor for it, `duration_scale`. */
      durationScale: boolean
    }

/** A speech synthesis model the bench can run, with the languages of its model card as BCP 47 tags. */
export type TtsModel = TtsRuntime & {
  id: string
  label: string
  files: readonly PinnedFile[]
  languages: readonly string[]
  /** Empty when the model has no voice built in and takes a reference or makes one up. */
  voices: readonly TtsVoice[]
  license: string
}

/** The talkers converted with their languages as BCP 47 tags, which speech.cpp v0.3.0 needs. */
const QWEN3_TTS = ['sakasegawa/qwen3-tts-ggml', '3fa3234ee65c9a70fd23a7b7843722a0284b8027'] as const
const QWEN3_TTS_CODEC = model(...QWEN3_TTS, 'qwen3-tts-codec-12hz-f16.gguf', 245_553_152, '38763be32099ad36b7b4345fc852ac379fb4fde0782ff85929d2b984b4bc22c1')

/** Qwen3-TTS has no Hindi and no Indonesian. */
const QWEN3_TTS_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it']

const IRODORI_V4_1 = ['sakasegawa/irodori-tts-ggml', '8a45f617775ebc1c71b047b8b80c8350ec010617'] as const
const IRODORI_V4_1_CODEC = model(...IRODORI_V4_1, 'semantic-dacvae-japanese-32dim-f32.gguf', 370_670_496, '43ef3084cedd88b73113db2663f1741d5deed97ae9a72d84dff4ff593374f125')

/**
 * Irodori-TTS v4.1 Small in speech.cpp: MF, the MeanFlow distillation that samples in 4 steps, and RF, the
 * rectified flow it was distilled from, 40 steps unless fewer are asked for. It has no voice of its own and
 * speaks like the reference voice of the run, given to the worker as a voice file made on the CPU, which
 * holds the official encoder's latent to 99 dB (speech.cpp's README, 2026-10-01).
 */
const irodoriV41 = (id: string, label: string, file: PinnedFile, steps: number | null): TtsModel => ({
  id,
  label,
  runtime: 'speech-worker',
  steps,
  voiceReference: true,
  files: [file, IRODORI_V4_1_CODEC],
  languages: ['ja'],
  voices: [],
  license: 'MIT'
})
const IRODORI_V4_1_MF = model(...IRODORI_V4_1, 'irodori-tts-v4.1-small-mf-f16.gguf', 1_514_765_472, '30b230256ce19a08b8769c582ca1afad0954a7c1f5d37b47c47e520b21d06262')
const IRODORI_V4_1_RF = model(...IRODORI_V4_1, 'irodori-tts-v4.1-small-f16.gguf', 1_500_347_520, '4a1d3e68e3647e48a8ba001a54caa7c6cc221fd3b8a2492a3087c93af4bbee74')

/** The CustomVoice speakers; each speaks every language of the model, most naturally its own. */
const QWEN3_TTS_VOICES: readonly TtsVoice[] = [
  { id: 'ono_anna', native: 'ja' },
  { id: 'ryan', native: 'en' },
  { id: 'aiden', native: 'en' },
  { id: 'sohee', native: 'ko' },
  { id: 'vivian', native: 'zh' },
  { id: 'serena', native: 'zh' },
  { id: 'uncle_fu', native: 'zh' },
  { id: 'dylan', native: 'zh' },
  { id: 'eric', native: 'zh' }
]

const IRODORI_V4_SMALL = model('audio-cpp/audio.cpp-gguf', '83c5d96c03023ff5a7712570d057ce26c8769f98', 'Irodori-TTS-v4-Small-GGUF/irodori-tts-v4-small-q8_0.gguf', 1_368_991_360, '0f1b96a1608f0a15ef2289e4d23f37c121cb8db3da702d1d5c4c2455b2437190')

/**
 * Irodori-TTS through audio.cpp, which packages it as "v4 Small". Without a reference or a description it
 * makes a voice up for every sentence, which follows the sentence more than the seed: on 2026-09-30 a
 * technical sentence came out at about 120 Hz in all of five seeds and a question at 160 to 208 Hz. The
 * steps are the rectified-flow steps; the model card's default is 40. On Metal the codec runs on the CPU:
 * audio.cpp's Metal codec (v0.8.2) adds a distorted copy of the voice 14 dB below it and raises the pauses
 * from -76 to -60 dBFS, heard as a doubled voice with a low hum, whatever the weight type, while the CPU
 * and Vulkan codecs do not; the CPU codec takes 4 to 7 times as long (2026-10-01, Apple M5).
 */
const irodori = (steps: number): TtsModel => ({
  id: steps === 40 ? 'irodori-tts-v4-small' : `irodori-tts-v4-small-${steps}steps`,
  label: `Irodori-TTS v4 Small Q8_0, ${steps} steps`,
  runtime: 'audio.cpp',
  family: 'irodori_tts',
  loadOptions: { metal: { 'irodori_tts.codec_backend': 'cpu' } },
  options: { language: 'ja', no_ref: true, num_inference_steps: steps },
  voiceDesign: true,
  voiceReference: true,
  durationScale: true,
  files: [IRODORI_V4_SMALL],
  languages: ['ja'],
  voices: [],
  license: 'MIT'
})

export const TTS_MODELS: readonly TtsModel[] = [
  {
    id: 'qwen3-tts-0.6b',
    label: 'Qwen3-TTS 0.6B CustomVoice Q8_0',
    runtime: 'speech-worker',
    steps: null,
    voiceReference: false,
    files: [model(...QWEN3_TTS, 'qwen3-tts-0.6b-customvoice-q8_0.gguf', 967_979_712, '4a819d1c9d9c6358bd5dc1ded15f93db970fbaeac9f0a021dfae62c242682baf'), QWEN3_TTS_CODEC],
    languages: QWEN3_TTS_LANGUAGES,
    voices: QWEN3_TTS_VOICES,
    license: 'Apache-2.0'
  },
  {
    id: 'qwen3-tts-1.7b',
    label: 'Qwen3-TTS 1.7B CustomVoice Q8_0',
    runtime: 'speech-worker',
    steps: null,
    voiceReference: false,
    files: [model(...QWEN3_TTS, 'qwen3-tts-1.7b-customvoice-q8_0.gguf', 2_042_225_472, 'fb6e79b6ae51c1fe5fe8313cf9a69e5c6f4e34a9869b478a576ed954b3d314e1'), QWEN3_TTS_CODEC],
    languages: QWEN3_TTS_LANGUAGES,
    voices: QWEN3_TTS_VOICES,
    license: 'Apache-2.0'
  },
  irodoriV41('irodori-tts-v4.1-small-mf', 'Irodori-TTS v4.1 Small MF F16', IRODORI_V4_1_MF, null),
  irodoriV41('irodori-tts-v4.1-small-16steps', 'Irodori-TTS v4.1 Small F16, 16 steps', IRODORI_V4_1_RF, 16),
  irodoriV41('irodori-tts-v4.1-small', 'Irodori-TTS v4.1 Small F16, 40 steps', IRODORI_V4_1_RF, null),
  irodori(40),
  irodori(16),
  irodori(8)
]

export function ttsModel(id: string): TtsModel {
  const found = TTS_MODELS.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`unknown synthesis model ${id}; the models are ${TTS_MODELS.map((candidate) => candidate.id).join(', ')}`)
  return found
}

/**
 * The voice a sentence in this locale is spoken with: the one asked for, or the model's voice native to
 * the language. A model with built-in voices but none native to the locale needs one named.
 */
export function ttsVoiceFor(model: TtsModel, locale: string, requested: string | undefined): string | null {
  if (model.voices.length === 0) {
    if (requested !== undefined) throw new Error(`${model.id} has no built-in voices to choose from`)
    return null
  }
  if (requested !== undefined) {
    if (!model.voices.some((voice) => voice.id === requested)) throw new Error(`${model.id} has no voice ${requested}; its voices are ${model.voices.map((voice) => voice.id).join(', ')}`)
    return requested
  }
  const native = model.voices.find((voice) => tagCovers(voice.native, locale))
  if (!native) throw new Error(`${model.id} has no voice native to ${locale}; name one with --voice (${model.voices.map((voice) => voice.id).join(', ')})`)
  return native.id
}

/** A small ONNX model run in this process through sherpa-onnx. */
export interface OnnxModel {
  id: string
  label: string
  file: PinnedFile
  license: string
}

/**
 * 3D-Speaker's ERes2NetV2, trained on about 200,000 Chinese speakers. On 2026-10-01, over utterances with
 * 1.5 s of voice or more, it rated the author's Japanese recordings 0.84 alike on average and 0.33 like men's
 * recordings in FLEURS; Qwen3-TTS's ono_anna 0.76 and Irodori-TTS without a voice description, whose voice
 * changes between sentences, 0.47 to 0.57. WeSpeaker's ResNet34, trained on VoxCeleb, told recorded speakers
 * apart as well but rated Irodori-TTS's changing voice 0.65 alike against ono_anna's 0.73, so it is not used
 * for synthesized speech.
 */
export const SPEAKER_MODEL: OnnxModel = {
  id: 'eres2netv2',
  label: '3D-Speaker ERes2NetV2',
  file: model('csukuangfj/speaker-embedding-models', '0743f301363dec56491a490f6d6cbc9d67f9a3bf', '3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx', 71_441_526, 'bf1a75b9930474cf3389ef415e6e5d38ca96fea4a3a00f7e301d080a58ee2239'),
  license: 'Apache-2.0'
}

/**
 * Silero VAD v4 as sherpa-onnx packages it, which finds where the voice of an utterance begins and ends so
 * that every model hears the same stretch of it.
 */
export const VAD_MODEL: OnnxModel = {
  id: 'silero-vad-v4',
  label: 'Silero VAD v4',
  file: model('csukuangfj/vad', 'fba88cd2e921609e7675c3aaf51e0b9b295da4bc', 'silero_vad.onnx', 1_807_522, 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28'),
  license: 'MIT'
}
