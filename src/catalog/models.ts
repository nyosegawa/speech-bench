import type { ConvertedFile, Converter } from './convert.ts'
import type { ModelFile } from './model-file.ts'
import type { PinnedFile } from './store.ts'
import { tagCovers } from '../core/language.ts'

/**
 * Where a model runs: llama-server with the language model and its audio projector, CrispASR with one GGUF and
 * the backend it loads as, which CrispASR's /health reports, speech.cpp's worker with the model's one GGUF file,
 * its audio encoder inside, in the layout speech.cpp v0.7.0 reads, and the decoding every request asks for, or null
 * for the model's default, NeMo-Speech.cpp's server with one GGUF file its converter made, or an adapter of the
 * model's official implementation with the checkpoint as it is published.
 */
export type AsrRuntime =
  | { runtime: 'llama-server' }
  | { runtime: 'crispasr'; backend: string }
  | { runtime: 'speech.cpp'; decoding: 'greedy' | null }
  | { runtime: 'nemo-speech.cpp' }
  | { runtime: 'adapter'; adapter: 'qwen3-asr' }

/** A speech recognition model the bench can run, with the languages its model card lists. */
export type AsrModel = AsrRuntime & {
  id: string
  label: string
  files: readonly ModelFile[]
  /** BCP 47 tags from the model card. A tag without a region covers every region of the language. */
  languages: readonly string[]
  /**
   * Whether a request can name the language, which then steers the model. parakeet-tdt-0.6b-v3 has no way to be
   * told it and detects the language itself, which the bench must not hide by passing one. speech.cpp's worker
   * takes the language of such a model only to check it, and a run stops on a model file that says otherwise.
   */
  languageHint: 'optional' | 'none'
  license: string
}

const QWEN3_ASR_LANGUAGES = ['zh', 'en', 'yue', 'ar', 'de', 'fr', 'es', 'pt', 'id', 'it', 'ko', 'ru', 'th', 'vi', 'ja', 'tr', 'hi', 'ms', 'nl', 'sv', 'da', 'fi', 'pl', 'cs', 'fil', 'fa', 'el', 'ro', 'hu', 'mk']

const PARAKEET_V3_LANGUAGES = ['bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr', 'hu', 'it', 'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'uk']

const model = (repo: string, revision: string, file: string, bytes: number, sha256: string): PinnedFile =>
  ({ kind: 'model', repo, revision, file, bytes, sha256 })

/**
 * ReazonSpeech NeMo v2 as speech.cpp converts it, of layout 1, which decodes with the checkpoint's beam search by
 * default and greedily when a request sets `decoding` in speech.cpp v0.8.0 and later.
 */
const REAZONSPEECH_SPEECH_CPP = model('sakasegawa/reazonspeech-nemo-v2-GGUF', 'cb9e436cf3f9d9563c610cb5318adcfc5c0fe098', 'reazonspeech-nemo-619M-v2-F16.gguf', 1_240_465_696, '1492147d7d18fbb0503db2cbbb05df4932cb3451e391524c6a2411632e4823bf')

/** NeMo-Speech.cpp's converter at v0.2.0, the release the bench runs. */
const NEMO_SPEECH_CONVERTER: Converter = {
  id: 'nemo-speech.cpp',
  repository: 'https://github.com/NVIDIA/NeMo-Speech.cpp',
  commit: '6a3ca369370782acee0dd155e34394ba60b920c4',
  script: 'convert_model.py'
}

/**
 * A NeMo checkpoint converted by NeMo-Speech.cpp's converter to F16, the weight type of speech.cpp's FastConformer
 * files, so that the two runtimes are compared on the same weights: NVIDIA publishes parakeet-tdt-0.6b-v3 for
 * NeMo-Speech.cpp in Q8_0 alone, and ReazonSpeech not at all (2026-10-08).
 */
const nemoSpeechF16 = (checkpoint: PinnedFile, file: string, bytes: number, sha256: Readonly<Record<string, string>>): ConvertedFile =>
  ({ kind: 'converted', converter: NEMO_SPEECH_CONVERTER, checkpoint, args: ['--outtype', 'fp16'], file, bytes, sha256 })

const QWEN3_ASR_1_7B = ['ggml-org/Qwen3-ASR-1.7B-GGUF', '36a678687ba7d07a74ca70ccb0e36902e005fb80'] as const
const QWEN3_ASR_0_6B = ['ggml-org/Qwen3-ASR-0.6B-GGUF', '928ab958557df9aa2ef1c93e0e83c7ad0933fae2'] as const

/** A checkpoint as its repository publishes it, at one revision: each file with its size and sha256. */
const checkpoint = (repo: string, revision: string, files: readonly [string, number, string][]): PinnedFile[] =>
  files.map(([file, size, sha256]) => model(repo, revision, file, size, sha256))

/** The tokenizer and the configurations Qwen3-ASR's two checkpoints share, the same files in both repositories. */
const QWEN3_ASR_TOKENIZER: readonly [string, number, string][] = [
  ['chat_template.json', 1_161, '75a8cfca24f00de72d796fbfed6858fc9614ef3dabd8696684cc3bc03a9c58ff'],
  ['generation_config.json', 142, '1da527824d81e07118facff437e03f2e24a23311e3bdeb2368973fe77e5f275c'],
  ['merges.txt', 1_671_853, '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5'],
  ['preprocessor_config.json', 330, '45e120a4eda2c20c5d7f2ea9354e63536bf35e27aa573fb7cdf78017b378770d'],
  ['tokenizer_config.json', 12_487, '4942d005604266809309cabc9f4e9cb89ce855d59b14681fdc0e1cc62ea26c4c'],
  ['vocab.json', 2_776_833, 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910']
]

/** Qwen3-ASR's checkpoints at the revisions speech.cpp converts and checks its port against. */
const OFFICIAL_QWEN3_ASR_0_6B = checkpoint('Qwen/Qwen3-ASR-0.6B', '5eb144179a02acc5e5ba31e748d22b0cf3e303b0', [
  ['config.json', 6_193, '76d3ae4601ce939830b2517f4a6cadb86cc51316c3900af6b020b051c21a478c'],
  ['model.safetensors', 1_876_091_704, '79d6cbd4c98c7bbffe9db2edac07f56cd6637d0d5944b27f6c2b8353840323ea'],
  ...QWEN3_ASR_TOKENIZER
])
const OFFICIAL_QWEN3_ASR_1_7B = checkpoint('Qwen/Qwen3-ASR-1.7B', '7278e1e70fe206f11671096ffdd38061171dd6e5', [
  ['config.json', 6_194, '2e74a751548b8ad7d7526d29365ad8144c345d8b412b1152d25dc6698452712f'],
  ['model-00001-of-00002.safetensors', 4_220_320_824, 'a4cd1f1a04d90b757dc7f7dd26254e69a013b19e80efe590a83c6a3bde8608d6'],
  ['model-00002-of-00002.safetensors', 478_200_688, '6e0b9d9e09e2e0238e7ef3cc8a484ab387e91b90f1900bedf88bc92d7929ccfc'],
  ['model.safetensors.index.json', 64_821, 'f994739fe38e5210b9e3e8ce6c6307315e2ceac3cb630e7b7414d69dce520f60'],
  ...QWEN3_ASR_TOKENIZER
])

/**
 * Qwen3-ASR as ggml-org converts it for llama-server, the CrispASR conversions of the NeMo models, all five in
 * speech.cpp, from the files speech.cpp converts from the models' checkpoints, two of the NeMo models in
 * NeMo-Speech.cpp, and Qwen3-ASR in its official code. The ids and labels of the speech.cpp, NeMo-Speech.cpp and
 * official entries name the runtime, so that runs of one model in two runtimes stay apart wherever only the model is
 * shown.
 */
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
  },
  {
    id: 'qwen3-asr-1.7b-speech.cpp',
    label: 'Qwen3-ASR 1.7B, speech.cpp Q8_0',
    runtime: 'speech.cpp',
    decoding: null,
    files: [model('sakasegawa/Qwen3-ASR-1.7B-GGUF', '75edaf1dd34c60409d3190dbcb36dbec70cad5ea', 'Qwen3-ASR-1.7B-Q8_0.gguf', 2_176_109_216, '5f219b78a1d9c3b9e97da27708b36f8a0bc1bfc1650b541c0a6dbaf87c9a62d0')],
    languages: QWEN3_ASR_LANGUAGES,
    languageHint: 'optional',
    license: 'Apache-2.0'
  },
  {
    id: 'qwen3-asr-0.6b-speech.cpp',
    label: 'Qwen3-ASR 0.6B, speech.cpp Q8_0',
    runtime: 'speech.cpp',
    decoding: null,
    files: [model('sakasegawa/Qwen3-ASR-0.6B-GGUF', 'f397b129caf08f201f79e67bbfafd1c6b59aeb05', 'Qwen3-ASR-0.6B-Q8_0.gguf', 841_502_336, '416e10c15b4a3d9002bd337d18fc450233fdf68502b6e10d1379d2789838afd0')],
    languages: QWEN3_ASR_LANGUAGES,
    languageHint: 'optional',
    license: 'Apache-2.0'
  },
  {
    id: 'parakeet-tdt-0.6b-v3-speech.cpp',
    label: 'parakeet-tdt-0.6b-v3, speech.cpp F16',
    runtime: 'speech.cpp',
    decoding: null,
    files: [model('sakasegawa/parakeet-tdt-0.6b-v3-GGUF', '304eaf83fc16e3087425b61b6652c4eafe003dc4', 'parakeet-tdt-0.6B-v3-F16.gguf', 1_255_370_688, '7b74de31ac48427934104f0d074613f8d759d7d108777c114476346789d94426')],
    languages: PARAKEET_V3_LANGUAGES,
    languageHint: 'none',
    license: 'CC-BY-4.0'
  },
  {
    id: 'parakeet-tdt_ctc-0.6b-ja-speech.cpp',
    label: 'parakeet-tdt_ctc-0.6b-ja, speech.cpp F16',
    runtime: 'speech.cpp',
    decoding: null,
    files: [model('sakasegawa/parakeet-tdt_ctc-0.6b-ja-GGUF', '48060c6e292b01c84edac8988db0163fd41d3fe2', 'parakeet-tdt_ctc-0.6B-ja-F16.gguf', 1_240_656_832, '71ddc10381a9d3b59e18fbc51422059293f1268676b1ca62adb45b791df05497')],
    languages: ['ja'],
    languageHint: 'none',
    license: 'CC-BY-4.0'
  },
  {
    id: 'reazonspeech-nemo-v2-speech.cpp',
    label: 'ReazonSpeech NeMo v2, speech.cpp F16',
    runtime: 'speech.cpp',
    decoding: null,
    files: [REAZONSPEECH_SPEECH_CPP],
    languages: ['ja'],
    languageHint: 'none',
    license: 'Apache-2.0'
  },
  {
    id: 'reazonspeech-nemo-v2-greedy-speech.cpp',
    label: 'ReazonSpeech NeMo v2, speech.cpp F16, greedy',
    runtime: 'speech.cpp',
    decoding: 'greedy',
    files: [REAZONSPEECH_SPEECH_CPP],
    languages: ['ja'],
    languageHint: 'none',
    license: 'Apache-2.0'
  },
  {
    id: 'parakeet-tdt-0.6b-v3-nemo-speech.cpp',
    label: 'parakeet-tdt-0.6b-v3, NeMo-Speech.cpp F16',
    runtime: 'nemo-speech.cpp',
    files: [nemoSpeechF16(
      model('nvidia/parakeet-tdt-0.6b-v3', '541d1f99c6b0c3cd0b11a95167540bb8edefd82b', 'parakeet-tdt-0.6b-v3.nemo', 2_509_332_480, '3cbdc85877e668ca7b82d0d56770eb1fac76691f55d6b97545e8d61ca588d10d'),
      'parakeet-tdt-0.6b-v3.f16.gguf', 1_296_681_120,
      { 'darwin-arm64': '6e55f55e5b2a141c98a000f24493fba52790e2fd54ef1c4dcfc130601136ebe7', 'win32-x64': 'c44ce57a060f8043e91e14771a5305b44f820c84b33f9789c9ae1aa7a3259e2f' }
    )],
    languages: PARAKEET_V3_LANGUAGES,
    languageHint: 'none',
    license: 'CC-BY-4.0'
  },
  // NeMo-Speech.cpp decodes an RNN-T model greedily alone. Its converter (v0.2.0) does not read the checkpoint's
  // global_tokens of 1, so its encoder attends to the 128 frames on either side of each frame without the global
  // token the checkpoint has and speech.cpp keeps; on the three longest Japanese FLEURS utterances (26.6 to 28.2 s),
  // its text was speech.cpp's greedy text to the character (2026-10-08).
  {
    id: 'reazonspeech-nemo-v2-nemo-speech.cpp',
    label: 'ReazonSpeech NeMo v2, NeMo-Speech.cpp F16, greedy',
    runtime: 'nemo-speech.cpp',
    files: [nemoSpeechF16(
      model('reazon-research/reazonspeech-nemo-v2', '33693408be76b7cba9fd4a7546a0a8772430211b', 'reazonspeech-nemo-v2.nemo', 2_477_946_880, 'd196d43ad03466ca88beeda4bf5fafb07bab7202d4b663b8e4f12cb0a4381fae'),
      'reazonspeech-nemo-v2.f16.gguf', 1_281_776_672,
      { 'darwin-arm64': '4b5806fd67f7bf9ff653c43f0343b6923dd88dc5620a64735011d222f8973e0e', 'win32-x64': '32b12198aeae0bda682ef115a23eca24d371dcffd6ab04d8a86de92518fcb833' }
    )],
    languages: ['ja'],
    languageHint: 'none',
    license: 'Apache-2.0'
  },
  {
    id: 'qwen3-asr-1.7b-official',
    label: 'Qwen3-ASR 1.7B, official BF16',
    runtime: 'adapter',
    adapter: 'qwen3-asr',
    files: OFFICIAL_QWEN3_ASR_1_7B,
    languages: QWEN3_ASR_LANGUAGES,
    languageHint: 'optional',
    license: 'Apache-2.0'
  },
  {
    id: 'qwen3-asr-0.6b-official',
    label: 'Qwen3-ASR 0.6B, official BF16',
    runtime: 'adapter',
    adapter: 'qwen3-asr',
    files: OFFICIAL_QWEN3_ASR_0_6B,
    languages: QWEN3_ASR_LANGUAGES,
    languageHint: 'optional',
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
 * Where a synthesis model runs: speech.cpp's worker, on the model's one GGUF file with its codec inside (layout 1,
 * which speech.cpp reads from v0.7.0 on, refusing the files converted before it), or an adapter of the model's
 * official implementation or of mlx-audio, with the sampler's steps when not the model's own and whether it speaks like a reference voice, or audio.cpp's server with the family it loads as, the options it
 * is loaded with on each GPU interface, the request options every sentence is sent with, and whether it takes
 * a voice described in words (`instruction`) and a reference voice to speak like.
 */
export type TtsRuntime =
  | { runtime: 'speech.cpp'; steps: number | null; voiceReference: boolean }
  | { runtime: 'adapter'; adapter: 'mlx-audio' | 'qwen3-tts' | 'drama3'; steps: number | null; voiceReference: boolean }
  /** Irodori-TTS's official runtime computes the model in FP32 or, on CUDA alone, in BF16; its codec stays in FP32. */
  | { runtime: 'adapter'; adapter: 'irodori-tts'; precision: 'fp32' | 'bf16'; steps: number | null; voiceReference: boolean }
  /**
   * SGLang Omni computes Drama 3 as its checkpoint's quantization says: in BF16 with the experts in FP8, or with the
   * experts and the attention projections in int4, run as W4A16.
   */
  | { runtime: 'adapter'; adapter: 'sglang-omni'; quantization: 'fp8-experts' | 'int4'; steps: number | null; voiceReference: boolean }
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
  files: readonly ModelFile[]
  languages: readonly string[]
  /** Empty when the model has no voice built in and takes a reference or makes one up. */
  voices: readonly TtsVoice[]
  license: string
}

/** Qwen3-TTS has no Hindi and no Indonesian. */
const QWEN3_TTS_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it']

/**
 * Irodori-TTS v4.1 Small in speech.cpp: MF, the MeanFlow distillation that samples in 4 steps, and RF, the
 * rectified flow it was distilled from, 40 steps unless fewer are asked for. It has no voice of its own and
 * speaks like the reference voice of the run, given to the worker as a voice file made on the CPU, which
 * holds the official encoder's latent to 99 dB (speech.cpp's README, 2026-10-01).
 */
const irodoriV41 = (id: string, label: string, file: PinnedFile, steps: number | null): TtsModel => ({
  id,
  label,
  runtime: 'speech.cpp',
  steps,
  voiceReference: true,
  files: [file],
  languages: ['ja'],
  voices: [],
  license: 'MIT'
})
const IRODORI_V4_1_MF = model('sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF', '99e5d77f6d92a70d4b9bff52829ac118fa1bf7d3', 'Irodori-TTS-848M-MF-v4.1-F16.gguf', 1_885_438_016, 'd59b2fca0b0884f80d02562a58b2f6c344871a92e4cf3607971d78affcc11987')
const IRODORI_V4_1_RF = model('sakasegawa/Irodori-TTS-v4.1-Small-GGUF', 'ec4559786501eda493300f420655caf431bdda27', 'Irodori-TTS-841M-v4.1-F16.gguf', 1_871_020_064, '70ab9f5e0de5269b232468af75cc1b97cdb216009abc6ed41329e7728567202a')

/**
 * Irodori-TTS v4 Large in speech.cpp, whose text encoder is T5Gemma 2's and whose files speech.cpp 0.8.7 and later
 * read; an earlier release refuses them by their layout. 40 steps unless fewer are asked for, in a voice file as
 * v4.1 Small. It is under the Gemma Terms of Use.
 */
const irodoriLarge = (id: string, label: string, file: PinnedFile, steps: number | null): TtsModel => ({
  ...irodoriV41(id, label, file, steps),
  license: 'Gemma'
})
const IRODORI_V4_LARGE = {
  q8_0: model('sakasegawa/Irodori-TTS-v4-Large-GGUF', '79cae5947a97e941c62912749e1387c8b35ec16b', 'Irodori-TTS-3.4B-v4-Q8_0.gguf', 3_875_154_272, '836a2deda5115e4400d25674612ff30d704a358d0b16cf96a3eb510dc416bc4e'),
  f16: model('sakasegawa/Irodori-TTS-v4-Large-GGUF', '79cae5947a97e941c62912749e1387c8b35ec16b', 'Irodori-TTS-3.4B-v4-F16.gguf', 6_957_138_240, 'a0d4751d88cb9befea38d893081f2b0e48206225da038d12784a25288ac86d50')
}

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
  precision: 'fp32',
  steps,
  voiceReference: true,
  files,
  languages: ['ja'],
  voices: [],
  license: 'MIT'
})

/**
 * Irodori-TTS v4 Large, 3.29B parameters, whose text and caption encoder is T5Gemma 2's and whose tokenizer is
 * Gemma's, in the official runtime. At FP32 the checkpoint is 13.2 GB; BF16 halves it, and the runtime refuses BF16
 * on any device but CUDA.
 */
const OFFICIAL_IRODORI_LARGE: PinnedFile[] = [
  model('Aratako/Irodori-TTS-v4-Large', '2e0c55428ce97268a507f1feeb2478f8d9148e8b', 'model.safetensors', 13_152_893_348, '0f3de3cdcb8cb82ac2d0089f2c051ab99e12eb7270625d06e3d1d303bad9e63c'),
  model('Aratako/Irodori-TTS-v4-Large', '2e0c55428ce97268a507f1feeb2478f8d9148e8b', 'tokenizer/tokenizer.json', 33_384_387, 'f5b325224482ec441ec5fbe2a5ac08c3758e0f9605f6e54368e31f736fcfb01d'),
  model('Aratako/Irodori-TTS-v4-Large', '2e0c55428ce97268a507f1feeb2478f8d9148e8b', 'tokenizer/tokenizer_config.json', 802, '1007769ea58b3c60a23a2ec21d99625f3433a18913492b9a7ea525759e312713'),
  OFFICIAL_IRODORI_RF.at(-1)!
]
const officialIrodoriLarge = (precision: 'fp32' | 'bf16'): TtsModel => ({
  id: `irodori-tts-v4-large-official${precision === 'fp32' ? '' : '-bf16'}`,
  label: `Irodori-TTS v4 Large, official ${precision.toUpperCase()}, 40 steps`,
  runtime: 'adapter',
  adapter: 'irodori-tts',
  precision,
  steps: null,
  voiceReference: true,
  files: OFFICIAL_IRODORI_LARGE,
  languages: ['ja'],
  voices: [],
  license: 'Gemma'
})

/** An mlx-community conversion of Irodori-TTS v4.1 for mlx-audio, its codec and tokenizer in the same repository. */
const mlxIrodori = (repo: string, revision: string, files: readonly [string, number, string][]): PinnedFile[] => [
  ...checkpoint(repo, revision, files),
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

/** The tokenizer and the codec Qwen3-TTS's two CustomVoice checkpoints share, the same files in both repositories. */
const QWEN3_TTS_SHARED: readonly [string, number, string][] = [
  ['generation_config.json', 245, 'f1b90b4513f3b34c62851049e2492d7b4c5940daf1276f89c82b8ef04127f3aa'],
  ['merges.txt', 1_671_839, '599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3'],
  ['preprocessor_config.json', 127, 'efdde1022ea9d76928bf7a9cd53139138f5ba2e466e837f08f6105ab1af1c119'],
  ['tokenizer_config.json', 7_344, 'dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670'],
  ['vocab.json', 2_776_833, 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910'],
  ['speech_tokenizer/config.json', 2_336, 'ee65bb901c876664ab8707c487157aa1a6ee57c65969b28fb5ec9dc211e68167'],
  ['speech_tokenizer/configuration.json', 76, '6bc26d64eb5024b4d1dab5a52371958b429256d6c9d59787f1f5294a54e0cebd'],
  ['speech_tokenizer/model.safetensors', 682_293_092, '836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258'],
  ['speech_tokenizer/preprocessor_config.json', 234, 'fcb3805e597e786d4067706e602f6688524640f8d3396790e2e09b5942fcbdfb']
]

/**
 * Qwen3-TTS CustomVoice in its official PyTorch implementation, from the checkpoints at the revisions speech.cpp
 * converts, sampled with the checkpoint's own settings.
 */
const officialQwen3Tts = (id: string, label: string, repo: string, revision: string, files: readonly [string, number, string][]): TtsModel => ({
  id,
  label,
  runtime: 'adapter',
  adapter: 'qwen3-tts',
  steps: null,
  voiceReference: false,
  files: checkpoint(repo, revision, [...files, ...QWEN3_TTS_SHARED]),
  languages: QWEN3_TTS_LANGUAGES,
  voices: QWEN3_TTS_VOICES,
  license: 'Apache-2.0'
})

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
  id: `irodori-tts-v4-small-${type}${steps === 40 ? '' : `-${steps}steps`}${codecOnMetal ? '-metal-codec' : ''}`,
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

/**
 * Fish Audio Drama 3, a 35B mixture of experts with 3B active, in its official implementation as fish-speech's API
 * server runs it on CUDA: bfloat16 with the experts in FP8, on a GPU of SM89 or later with 80 GB, which the bench rents
 * as a Linux machine. It has no voice of its own and clones the run's reference voice from its WAVE file and
 * transcript. Its languages are those of the model card's metadata, with Javanese as `jv` where the card writes `jw`.
 * It is under the Fish Audio Community License: research, non-commercial use, and commercial use below USD 500,000 of
 * annual revenue.
 */
const OFFICIAL_DRAMA_3: TtsModel = {
  id: 'drama-3-official',
  label: 'Fish Audio Drama 3, official BF16 with FP8 experts',
  runtime: 'adapter',
  adapter: 'drama3',
  steps: null,
  voiceReference: true,
  files: checkpoint('fishaudio/drama-3', 'e0a9218aa48888270f06ef1ed9ea67622c0e17d2', [
    ['config.json', 5_535, '4b13a31b504cf54181f52df5bbb27604f5cc4b77b6e90a12ab85d62e0d70b693'],
    ['model.safetensors.index.json', 6_880_197, '7a2d824d4b073963a816f0d7e3b2e33bac89ae10c691bf8652325e61abc9f5c0'],
    ['model-00001-of-00008.safetensors', 5_000_202_800, 'e486b4f438d0b2df28846e41e599bd2077a64a825893ed0371b332a40dc4b49b'],
    ['model-00002-of-00008.safetensors', 5_000_496_824, 'a67b726fe950ad57ebc15696009bde4a7dbbdc3645b42fa7d77e3a5fa1d70262'],
    ['model-00003-of-00008.safetensors', 5_000_988_520, 'acfdeb67b8c4cb4784d887339e85bddbc5d7b9be3bbee82e40fa10ffe305d965'],
    ['model-00004-of-00008.safetensors', 5_000_496_392, 'fa2960bddf128f51c3d4d74a1a942e34f61cc7ea294d10aec27f79dc10455c9f'],
    ['model-00005-of-00008.safetensors', 5_000_227_096, 'a49ed8717c47e12b354a711c71ecde8be153bad704ca0a25d4805534f4405971'],
    ['model-00006-of-00008.safetensors', 4_984_792_768, '8867c0e3d600ebf28cf4734fc433dc98061fb990940e07b192ec0356ba1ff223'],
    ['model-00007-of-00008.safetensors', 4_977_946_704, '51e7d473f8a270bf79b2896a6ea4f19162eeec5b1ea1c5a2ba7dc7750511dbda'],
    ['model-00008-of-00008.safetensors', 4_638_423_240, 'c5b065cce3b3b851369dfdb5a3b60f6abf2699121071c2b1a9dfd84acb7b8f7d'],
    ['tokenizer.json', 20_791_070, '0e9b9db76b2f0389b04b6ef057a2ac3b89100b7e96f2dd7034d19580a09654d6'],
    ['codec.pth', 1_871_099_728, '74fc41c5a7151c6f350af8bd7e5d6e3accfcc7f3dfbfac23afd35af07052bb2f']
  ]),
  languages: [
    'zh', 'en', 'ja', 'ko', 'es', 'pt', 'ar', 'ru', 'fr', 'de', 'sv', 'it', 'tr', 'no', 'nl', 'cy', 'eu', 'ca', 'da', 'gl',
    'ta', 'hu', 'fi', 'pl', 'et', 'hi', 'la', 'ur', 'th', 'vi', 'jv', 'bn', 'yo', 'sl', 'cs', 'sw', 'nn', 'he', 'ms', 'uk',
    'id', 'kk', 'bg', 'lv', 'my', 'tl', 'sk', 'ne', 'fa', 'af', 'el', 'bo', 'hr', 'ro', 'sn', 'mi', 'yi', 'am', 'be', 'km',
    'is', 'az', 'sd', 'br', 'sq', 'ps', 'mn', 'ht', 'ml', 'sr', 'sa', 'te', 'ka', 'bs', 'pa', 'lt', 'kn', 'si', 'hy', 'mr',
    'as', 'gu', 'fo'
  ],
  voices: [],
  license: 'Fish Audio Community License'
}

/**
 * Fish Audio Drama 3 served by SGLang Omni, the server of Fish Audio's cookbook, through CUDA 13 on a Linux machine the
 * bench rents. It clones the run's reference voice from its WAVE file and transcript, samples with the model card's
 * settings, and has the official entry's languages and license. The server reads the checkpoint's config, index, shards
 * and tokenizer.json, and the codec beside them.
 */
const sglangDrama3 = (id: string, label: string, quantization: 'fp8-experts' | 'int4', files: readonly ModelFile[]): TtsModel => ({
  id,
  label,
  runtime: 'adapter',
  adapter: 'sglang-omni',
  quantization,
  steps: null,
  voiceReference: true,
  files,
  languages: OFFICIAL_DRAMA_3.languages,
  voices: [],
  license: OFFICIAL_DRAMA_3.license
})

/**
 * fishaudio/drama-3-int4, an unofficial GPTQ quantization of Drama 3 whose experts and attention projections hold
 * symmetric 4-bit weights, one scale per 128 input channels, run on GPTQ-Marlin kernels, with the rest in BF16: 20.8 GB
 * of weights on the GPU against the official checkpoint's 37.0 GB, as SGLang Omni's cookbook measures them.
 */
const DRAMA_3_INT4 = checkpoint('fishaudio/drama-3-int4', 'a6f588691a13b6607cb09f9800556487ab7aa0fe', [
  ['config.json', 6_019, '496b5d5a033c6497f2db68a6cdfcbe07c37fbe3c43e9c703b3d4f03e7073f5fd'],
  ['model.safetensors.index.json', 6_643_280, 'b4efab813630b87ad65f91d6b3b7efb258d92dcc2dee901e7a42697c10b55011'],
  ['model-00001-of-00012.safetensors', 2_000_535_888, '1d17414dc1abf63ff063a590b2447d24f6ea7f18d5dd14d00576232231bd1eee'],
  ['model-00002-of-00012.safetensors', 2_001_314_592, '77d83c82a83bc02b4893ab22257415806aa8400d2ba31416d26e27d9052b88bc'],
  ['model-00003-of-00012.safetensors', 2_001_489_696, '607da15109e98ab1b1de60fc3bb9db3246ce71cd974310f66e5b259c7190d53e'],
  ['model-00004-of-00012.safetensors', 2_001_332_856, '476ebbc278d262ba9c9f43dbed0a7194fdd783c3046f418eebafa475fe910a9f'],
  ['model-00005-of-00012.safetensors', 2_001_385_568, '204b11abc1e223c05b9b025941b4d9b9e9b71c1d410656d3292d9e1cb909ac53'],
  ['model-00006-of-00012.safetensors', 2_001_201_200, '2aa11e163646420fd3cbbe4d28fe258ce64868299c3f4cc08109eda78f69ca40'],
  ['model-00007-of-00012.safetensors', 2_001_466_576, '135e10983dee048cb5fd9b1aa54731bb26e7de71a5fb3788a3aa770dfd2b8ab0'],
  ['model-00008-of-00012.safetensors', 2_006_184_792, '72ae08e3f7e6bd2f352c882b17e386b74ec898eb0d5f61bb2707b6b6d6c656b1'],
  ['model-00009-of-00012.safetensors', 2_001_368_888, 'fe327f32b05c4783e63ba63e09e63d4e25c092983533763082e3cdfb5bbfd03c'],
  ['model-00010-of-00012.safetensors', 2_003_610_704, '82fc8904de8bdb7d1e30e30a8293075f8a123e9db1cffe5e3a866be286d66121'],
  ['model-00011-of-00012.safetensors', 2_000_926_592, '8c627d0980146857c8742ed6841041a9350774d7974796231a8f063bd7d11206'],
  ['model-00012-of-00012.safetensors', 80_001_416, '2b72dc82f247f36881859ce05d36c8f6b02dfe9fd5fa3237c579b958c07b28a7'],
  ['tokenizer.json', 20_791_070, '0e9b9db76b2f0389b04b6ef057a2ac3b89100b7e96f2dd7034d19580a09654d6'],
  ['codec.pth', 1_871_099_728, '74fc41c5a7151c6f350af8bd7e5d6e3accfcc7f3dfbfac23afd35af07052bb2f']
])

/**
 * Fish Audio Drama 3 in speech.cpp, one GGUF file of each weight type with its codec inside, which speech.cpp 0.8.8 and
 * later read; speech.cpp's name `drama-3` fetches the Q4_K file, which `drama-3` is here too. It
 * clones the run's reference voice from a voice file made of the reference's WAVE file and the words of its takes, and
 * samples with the file's defaults, the model card's temperature 1.0, top-p 0.9 and top-k 30, as the official entry
 * does. A GPU without the memory for the whole file keeps the experts of the later layers on the CPU. It is under the
 * Fish Audio Community License.
 */
const drama3 = (id: string, label: string, file: PinnedFile): TtsModel => ({
  id,
  label,
  runtime: 'speech.cpp',
  steps: null,
  voiceReference: true,
  files: [file],
  languages: OFFICIAL_DRAMA_3.languages,
  voices: [],
  license: OFFICIAL_DRAMA_3.license
})
const DRAMA_3 = {
  q4_k: model('sakasegawa/drama-3-GGUF', 'b6fa51cff778b69e72ee4994f85311b4c5ab6bc5', 'Drama-35B-A3B-v3-Q4_K.gguf', 20_787_264_352, '2a57b14c9b208a2ff833ab7305b920ca8f154ad807004a52d96a86a90a55523e'),
  f16: model('sakasegawa/drama-3-GGUF', 'b6fa51cff778b69e72ee4994f85311b4c5ab6bc5', 'Drama-35B-A3B-v3-F16.gguf', 71_612_483_232, '99f63d2f1d5c6af1b113518f74bab17fdcbcf306c6c4bed40669f665092d3491'),
  q8_0: model('sakasegawa/drama-3-GGUF', 'b6fa51cff778b69e72ee4994f85311b4c5ab6bc5', 'Drama-35B-A3B-v3-Q8_0.gguf', 38_465_601_376, 'db0b1f195b4e49183ef5aa84de8af78bb8f873bcdab73ef60931598bc7b95da8'),
  q6_k: model('sakasegawa/drama-3-GGUF', 'b6fa51cff778b69e72ee4994f85311b4c5ab6bc5', 'Drama-35B-A3B-v3-Q6_K.gguf', 29_902_656_896, 'bb232b7ac08cffc5cd5f21a69e37bdbf198351c45433fd57e156992da934f9fe'),
  q5_k: model('sakasegawa/drama-3-GGUF', 'b6fa51cff778b69e72ee4994f85311b4c5ab6bc5', 'Drama-35B-A3B-v3-Q5_K.gguf', 25_206_848_608, '3a26462bf34e504df5026193563910338be3140e243a516e1b8661e18037c21a')
}

export const TTS_MODELS: readonly TtsModel[] = [
  {
    id: 'qwen3-tts-0.6b',
    label: 'Qwen3-TTS 0.6B CustomVoice Q8_0',
    runtime: 'speech.cpp',
    steps: null,
    voiceReference: false,
    files: [model('sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF', '28707fd399be0ae418681eec1e065804527eac6c', 'Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf', 1_213_534_464, 'f606ea3981aa42762b16db9a94826d2d560eb60f0b102001618f40d5a2f78cc6')],
    languages: QWEN3_TTS_LANGUAGES,
    voices: QWEN3_TTS_VOICES,
    license: 'Apache-2.0'
  },
  {
    id: 'qwen3-tts-1.7b',
    label: 'Qwen3-TTS 1.7B CustomVoice Q8_0',
    runtime: 'speech.cpp',
    steps: null,
    voiceReference: false,
    files: [model('sakasegawa/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF', '0c0dc3861a19d0b98085b6f9973b6a5933b382a3', 'Qwen3-TTS-12Hz-1.7B-CustomVoice-Q8_0.gguf', 2_287_780_352, '1bc0ef69547c003507b6536639a6080c8856382f4d0963b15d4475528330592d')],
    languages: QWEN3_TTS_LANGUAGES,
    voices: QWEN3_TTS_VOICES,
    license: 'Apache-2.0'
  },
  officialQwen3Tts('qwen3-tts-0.6b-official', 'Qwen3-TTS 0.6B CustomVoice, official BF16', 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice', '85e237c12c027371202489a0ec509ded67b5e4b5', [
    ['config.json', 4_908, '81aca2b6fac304944d8acf345272d8a9a727d5fc2e2e66b222ab4729340c7455'],
    ['model.safetensors', 1_811_626_576, 'bc3c7e785eb961179c25450d1acff03f839e0002f2f3a5aeb67b5735c0fa2adb']
  ]),
  officialQwen3Tts('qwen3-tts-1.7b-official', 'Qwen3-TTS 1.7B CustomVoice, official BF16', 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice', '0c0e3051f131929182e2c023b9537f8b1c68adfe', [
    ['config.json', 4_908, '17a07f527a1c25ea30b4e023a184482a23d3e279d697b1dc81b1bde498d29cf9'],
    ['model.safetensors', 3_833_402_552, '38b1d5971bdbd982b561cccec982669a53b0537c3cf5e9bd4778ed07bb2f5137']
  ]),
  irodoriV41('irodori-tts-v4.1-small-mf', 'Irodori-TTS v4.1 Small MF F16', IRODORI_V4_1_MF, null),
  irodoriV41('irodori-tts-v4.1-small-16steps', 'Irodori-TTS v4.1 Small F16, 16 steps', IRODORI_V4_1_RF, 16),
  irodoriV41('irodori-tts-v4.1-small', 'Irodori-TTS v4.1 Small F16, 40 steps', IRODORI_V4_1_RF, null),
  officialIrodoriV41('irodori-tts-v4.1-small-mf-official', 'Irodori-TTS v4.1 Small MF, official FP32', OFFICIAL_IRODORI_MF, null),
  officialIrodoriV41('irodori-tts-v4.1-small-16steps-official', 'Irodori-TTS v4.1 Small, official FP32, 16 steps', OFFICIAL_IRODORI_RF, 16),
  officialIrodoriV41('irodori-tts-v4.1-small-official', 'Irodori-TTS v4.1 Small, official FP32, 40 steps', OFFICIAL_IRODORI_RF, null),
  irodoriLarge('irodori-tts-v4-large', 'Irodori-TTS v4 Large Q8_0, 40 steps', IRODORI_V4_LARGE.q8_0, null),
  irodoriLarge('irodori-tts-v4-large-16steps', 'Irodori-TTS v4 Large Q8_0, 16 steps', IRODORI_V4_LARGE.q8_0, 16),
  irodoriLarge('irodori-tts-v4-large-f16-16steps', 'Irodori-TTS v4 Large F16, 16 steps', IRODORI_V4_LARGE.f16, 16),
  officialIrodoriLarge('fp32'),
  officialIrodoriLarge('bf16'),
  drama3('drama-3', 'Fish Audio Drama 3 Q4_K', DRAMA_3.q4_k),
  drama3('drama-3-f16', 'Fish Audio Drama 3 F16', DRAMA_3.f16),
  drama3('drama-3-q8_0', 'Fish Audio Drama 3 Q8_0', DRAMA_3.q8_0),
  drama3('drama-3-q6_k', 'Fish Audio Drama 3 Q6_K', DRAMA_3.q6_k),
  drama3('drama-3-q5_k', 'Fish Audio Drama 3 Q5_K', DRAMA_3.q5_k),
  OFFICIAL_DRAMA_3,
  sglangDrama3('drama-3-sglang', 'Fish Audio Drama 3, SGLang Omni BF16 with FP8 experts', 'fp8-experts', OFFICIAL_DRAMA_3.files),
  sglangDrama3('drama-3-int4-sglang', 'Fish Audio Drama 3 int4 (unofficial, W4A16), SGLang Omni', 'int4', DRAMA_3_INT4),
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
