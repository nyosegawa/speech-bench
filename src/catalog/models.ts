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
 * Where a synthesis model runs: speech.cpp's worker or an adapter of the model's official implementation, with the
 * sampler's steps when not the model's own and whether it speaks like a reference voice, or audio.cpp's server with the family it loads as, the options it
 * is loaded with on each GPU interface, the request options every sentence is sent with, and whether it takes
 * a voice described in words (`instruction`) and a reference voice to speak like.
 */
export type TtsRuntime =
  | { runtime: 'speech-worker'; steps: number | null; voiceReference: boolean }
  | { runtime: 'adapter'; adapter: 'irodori-tts' | 'mlx-audio'; steps: number | null; voiceReference: boolean }
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

/** The tokenizer Irodori-TTS v4.1's checkpoints carry beside them, the same file in both repositories. */
const officialIrodori = (repo: string, revision: string, size: number, sha256: string): PinnedFile[] => [
  model(repo, revision, 'model.safetensors', size, sha256),
  model(repo, revision, 'tokenizer/tokenizer.json', 6_718_495, '6a0734cf21c802169defaffe719bc2ef12bb9d0be37e54b61ed27aa89394723d'),
  model(repo, revision, 'tokenizer/tokenizer_config.json', 668, 'd229a271c64de1a7939d20d3665498e873fa91d5ee2edf135d73ec752cb9c9d3'),
  model('Aratako/Semantic-DACVAE-Japanese-32dim', '47376ee24834d7a05a48ebabfe3cde29b3c5e214', 'weights.pth', 429_620_065, 'db120339c5ee7eca1912cdf29bc612b947a0808e69c3cebfb4936b45a762c1d5')
]
const OFFICIAL_IRODORI_MF = officialIrodori('Aratako/Irodori-TTS-v4.1-Small-MF', 'ccc78f5d480b6e51b69b2d5042a14c4da04fea6e', 3_093_131_788, 'a3f204b3ee06058f4e639a1af38408e7e3af5b6c75176897ecb8bfaaebb4fd54')
const OFFICIAL_IRODORI_RF = officialIrodori('Aratako/Irodori-TTS-v4.1-Small', '2b28324dc263ed5e6638b3cf3dd94c82ead07b4b', 3_064_295_596, 'c85de88c01700cb53538e706f128ebcb1b8513ad21d7d0e75f58bc82cdbf89f6')

/**
 * Irodori-TTS v4.1 Small in its official PyTorch runtime, at FP32 as released, to check speech.cpp's port
 * against: the same checkpoints, sampled with the runtime's own defaults unless steps are asked for.
 */
const officialIrodoriV41 = (id: string, label: string, files: PinnedFile[], steps: number | null): TtsModel => ({
  id,
  label,
  runtime: 'adapter',
  adapter: 'irodori-tts',
  steps,
  voiceReference: true,
  files,
  languages: ['ja'],
  voices: [],
  license: 'MIT'
})

/** An mlx-community conversion of Irodori-TTS v4.1 for mlx-audio, its codec and tokenizer in the same repository. */
const mlxIrodori = (repo: string, revision: string, files: readonly [string, number, string][]): PinnedFile[] => [
  ...files.map(([file, size, sha256]) => model(repo, revision, file, size, sha256)),
  model(repo, revision, 'tokenizer/tokenizer.json', 6_718_495, '6a0734cf21c802169defaffe719bc2ef12bb9d0be37e54b61ed27aa89394723d'),
  model(repo, revision, 'tokenizer/tokenizer_config.json', 668, 'd229a271c64de1a7939d20d3665498e873fa91d5ee2edf135d73ec752cb9c9d3')
]
const MLX_IRODORI_MF = mlxIrodori('mlx-community/Irodori-TTS-v4.1-Small-MF-fp16', 'db0263236d010d4beb6ca67c529f410a6f71d755', [
  ['config.json', 5_209, 'd181702b6c6977cd4d5cfa23462abbd26b2122e3d4306971bbec563073f7d2ce'],
  ['model.safetensors', 1_546_609_131, '19bd887050cb3a6e799f4043aa2e20c11c1783f3af04e6c4d8ee0f172d24e483'],
  ['dacvae/config.json', 300, '86aeeace595882a046d50c010971d79ed2e6bf1215a6b51b18e99b50b3fadeac'],
  ['dacvae/model.safetensors', 429_504_222, '7366646af3d250ec0162c2b2717a64f7dbd5b8bfaebbf9ed69ad79db4944b8b9']
])
const MLX_IRODORI_RF = mlxIrodori('mlx-community/Irodori-TTS-v4.1-Small-fp16', '8be8d91091380115f1ac77aeb6604ed588d05372', [
  ['config.json', 4_646, '1fd3b64b681229e5226a873de625589aa0fffc865c0404389b92e917c8c6708b'],
  ['model.safetensors', 1_532_191_034, '99e022893ed27353aea6fca3897ee94c62bbaa568d705d230ee9b69f80a3a3bf'],
  ['dacvae/config.json', 329, '8e01edaa4900841e36e1970bfced16470e8e4f4a5dc710f6ace1deefe731daf4'],
  ['dacvae/model.safetensors', 429_504_516, '0bf3ff42e8101bd42ad082115ff0ea6867b6e994e64ab45f247bd50c49d0a0b9']
])

/** Irodori-TTS v4.1 Small in mlx-audio, from mlx-community's FP16 conversions, on the Mac's GPU through MLX. */
const mlxIrodoriV41 = (id: string, label: string, files: PinnedFile[], steps: number | null): TtsModel => ({
  id,
  label,
  runtime: 'adapter',
  adapter: 'mlx-audio',
  steps,
  voiceReference: true,
  files,
  languages: ['ja'],
  voices: [],
  license: 'MIT'
})

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

const IRODORI_V4_SMALL = {
  q8_0: model('audio-cpp/audio.cpp-gguf', '83c5d96c03023ff5a7712570d057ce26c8769f98', 'Irodori-TTS-v4-Small-GGUF/irodori-tts-v4-small-q8_0.gguf', 1_368_991_360, '0f1b96a1608f0a15ef2289e4d23f37c121cb8db3da702d1d5c4c2455b2437190'),
  f16: model('audio-cpp/audio.cpp-gguf', 'e36610ac69b5262e914a52635324050bee8f1ad2', 'Irodori-TTS-v4-Small-GGUF/irodori-tts-v4-small-f16.gguf', 1_762_148_352, '4c30f25aaeb7c273194ee11e25c2ca3e7abde4c09dba8d86b1727528a57bfdd8')
}

/**
 * Irodori-TTS through audio.cpp, which packages it as "v4 Small". Without a reference or a description it
 * makes a voice up for every sentence, which follows the sentence more than the seed: on 2026-09-30 a
 * technical sentence came out at about 120 Hz in all of five seeds and a question at 160 to 208 Hz. The
 * steps are the rectified-flow steps; the model card's default is 40. On Metal the codec runs on the CPU:
 * audio.cpp's Metal codec adds a distorted copy of the voice, heard as a doubled voice with a low hum, while
 * the CPU and Vulkan codecs do not. With v0.8.2 it sat 14 dB below the voice and raised the pauses from -76 to
 * -60 dBFS whatever the weight type, and the CPU codec took 4 to 7 times as long (2026-10-01, Apple M5). With
 * v0.9.0 the pauses rose from -76.5 to -55.9 dBFS at the median of the 20 Japanese sentences and the heard CER
 * from 5.31% to 9.12% with F16 at 16 steps, and the CPU codec made the median first audio 20.9 s against 2.0 s
 * (2026-10-05, Apple M5). A model whose codec runs on Metal measures how fast audio.cpp is on the Mac's GPU
 * alone, and its speech is not trusted.
 */
const irodori = (steps: number, type: keyof typeof IRODORI_V4_SMALL = 'q8_0', codecOnMetal = false): TtsModel => ({
  id: `irodori-tts-v4-small${type === 'q8_0' ? '' : `-${type}`}${steps === 40 ? '' : `-${steps}steps`}${codecOnMetal ? '-metal-codec' : ''}`,
  label: `Irodori-TTS v4 Small ${type === 'q8_0' ? 'Q8_0' : 'F16'}, ${steps} steps${codecOnMetal ? ', codec on Metal' : ''}`,
  runtime: 'audio.cpp',
  family: 'irodori_tts',
  loadOptions: { metal: { 'irodori_tts.codec_backend': codecOnMetal ? 'same' : 'cpu' } },
  options: { language: 'ja', no_ref: true, num_inference_steps: steps },
  voiceDesign: true,
  voiceReference: true,
  durationScale: true,
  files: [IRODORI_V4_SMALL[type]],
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
  officialIrodoriV41('irodori-tts-v4.1-small-mf-official', 'Irodori-TTS v4.1 Small MF, official FP32', OFFICIAL_IRODORI_MF, null),
  officialIrodoriV41('irodori-tts-v4.1-small-16steps-official', 'Irodori-TTS v4.1 Small, official FP32, 16 steps', OFFICIAL_IRODORI_RF, 16),
  officialIrodoriV41('irodori-tts-v4.1-small-official', 'Irodori-TTS v4.1 Small, official FP32, 40 steps', OFFICIAL_IRODORI_RF, null),
  mlxIrodoriV41('irodori-tts-v4.1-small-mf-mlx', 'Irodori-TTS v4.1 Small MF, mlx-audio FP16', MLX_IRODORI_MF, null),
  mlxIrodoriV41('irodori-tts-v4.1-small-16steps-mlx', 'Irodori-TTS v4.1 Small, mlx-audio FP16, 16 steps', MLX_IRODORI_RF, 16),
  irodori(40),
  irodori(16),
  irodori(8),
  irodori(16, 'f16'),
  irodori(16, 'f16', true)
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
