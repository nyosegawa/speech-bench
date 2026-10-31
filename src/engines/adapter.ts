import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../core/paths.ts'
import type { WorkerCommand } from './worker.ts'

/**
 * A model's official implementation run in an adapter of the bench's own, `adapters/<id>/`, which speaks
 * speech.cpp's worker protocol 3: a Python project whose lock file pins every package, and the package of the
 * implementation, whose pinned commit or release is the runtime's version.
 */
export interface Adapter {
  id: string
  /** The package of the implementation, named in the project's dependencies with the commit or release it is pinned to. */
  implementation: string
  /** The worker's path from the adapter's folder, which may lead to another adapter's worker run in this environment. */
  script: string
  /** How long the adapter may take to become ready, where its loading takes longer than a worker's usually does. */
  readySeconds?: number
}

export const IRODORI_TTS_ADAPTER: Adapter = { id: 'irodori-tts', implementation: 'irodori-tts', script: 'worker.py' }

export const QWEN3_TTS_ADAPTER: Adapter = { id: 'qwen3-tts', implementation: 'qwen-tts', script: 'worker.py' }

/**
 * Qwen3-ASR as transformers implements it, with qwen-asr's audio handling, prompt and parse: the release of
 * transformers is the version, as the code that runs the model.
 */
export const QWEN3_ASR_ADAPTER: Adapter = { id: 'qwen3-asr', implementation: 'transformers', script: 'worker.py' }

/** Fish Audio Drama 3 in fish-speech, Fish Audio's own implementation, whose commit is the version. */
export const DRAMA3_ADAPTER: Adapter = { id: 'drama3', implementation: 'fish-speech', script: 'worker.py' }

/**
 * Fish Audio Drama 3 served by SGLang Omni, the server of Fish Audio's cookbook, whose commit is the version. The
 * adapter gives the server 1800 s to start, as SGLang Omni's benchmark guides give a cold start, and then encodes each
 * voice with a short request; it is given longer, so that its own `fatal` names a server that does not start.
 */
export const SGLANG_OMNI_ADAPTER: Adapter = { id: 'sglang-omni', implementation: 'sglang-omni', script: 'worker.py', readySeconds: 2100 }

/** mlx-audio, which runs ports of many models on Apple's MLX, here for its Irodori-TTS. */
export const MLX_AUDIO_ADAPTER: Adapter = { id: 'mlx-audio', implementation: 'mlx-audio', script: 'worker.py' }

/**
 * mlx-audio for its speech recognition, here Nemotron 3.5 Transcribe, pinned apart from its Irodori-TTS at the commit
 * the MLX conversion it runs was made and checked with, so that the synthesis entries stay at the commit they were
 * measured at.
 */
export const MLX_AUDIO_ASR_ADAPTER: Adapter = { id: 'mlx-audio-asr', implementation: 'mlx-audio', script: 'worker.py' }

/**
 * transformers for the speech recognition models whose cards run them in it, each with its card's code: the release
 * of transformers is the version, as the code that runs the models.
 */
export const TRANSFORMERS_ASR_ADAPTER: Adapter = { id: 'transformers-asr', implementation: 'transformers', script: 'worker.py' }

/**
 * The transformers adapter's worker in an environment of transformers 4.57, for ReazonSpeech's CTC models, whose
 * Zipformer carries modeling code that transformers 5 cannot load.
 */
export const TRANSFORMERS_4_ASR_ADAPTER: Adapter = { id: 'transformers-4-asr', implementation: 'transformers', script: path.join('..', TRANSFORMERS_ASR_ADAPTER.id, TRANSFORMERS_ASR_ADAPTER.script) }

/** ReazonSpeech's k2 model in ReazonSpeech's own package, whose commit is the version. */
export const REAZONSPEECH_K2_ADAPTER: Adapter = { id: 'reazonspeech-k2', implementation: 'reazonspeech-k2-asr', script: 'worker.py' }

/**
 * NeMo for ReazonSpeech NeMo v2, through ReazonSpeech's own package, and for parakeet-tdt_ctc-0.6b-ja: the release of
 * NeMo is the version, as the code that runs both.
 */
export const NEMO_ASR_ADAPTER: Adapter = { id: 'nemo-asr', implementation: 'nemo_toolkit', script: 'worker.py' }

/** VibeVoice-ASR-Streaming in Microsoft's VibeVoice, whose commit is the version. */
export const VIBEVOICE_ASR_ADAPTER: Adapter = { id: 'vibevoice-asr', implementation: 'vibevoice', script: 'worker.py' }

const folderOf = (adapter: Adapter): string => path.join(import.meta.dirname, '..', '..', 'adapters', adapter.id)

/** The file of the adapter's worker. */
export const adapterScript = (adapter: Adapter): string => path.join(folderOf(adapter), adapter.script)

/** The adapter's Python environment, in the data folder with the other downloads rather than in the repository. */
const environmentOf = (adapter: Adapter): Record<string, string> => ({ UV_PROJECT_ENVIRONMENT: path.join(dataDir(), 'adapters', adapter.id) })

/**
 * The version of `implementation` that the text of a pyproject.toml pins among its dependencies, with or without
 * extras: the commit of a git dependency, shortened, which may name the package's subdirectory after it, or the pin of
 * a release, which names the package, since the adapter's id may name another.
 */
export function pinnedVersion(project: string, implementation: string): string {
  const named = `"${implementation}(?:\\[[^\\]"]*\\])?`
  const commit = new RegExp(`${named} @ git\\+[^@"]+@([0-9a-f]{40})(?:#subdirectory=[^"#]+)?"`).exec(project)
  if (commit) return commit[1]!.slice(0, 12)
  const release = new RegExp(`${named}==([^",;\\s]+)"`).exec(project)
  if (release) return `${implementation}==${release[1]!}`
  throw new Error(`the project does not pin ${implementation} to a commit or a release`)
}

/** The version of the implementation the adapter's project pins. */
export function adapterVersion(adapter: Adapter): string {
  const file = path.join(folderOf(adapter), 'pyproject.toml')
  try {
    return pinnedVersion(fs.readFileSync(file, 'utf8'), adapter.implementation)
  } catch (error) {
    throw new Error(`${file}: ${(error as Error).message}`, { cause: error })
  }
}

/**
 * Installs the packages the adapter's lock file pins, which on the first run downloads PyTorch, and compiles their
 * bytecode, and does nothing more once they are installed. It runs before the worker starts, so that neither is timed
 * as loading: Python otherwise compiles a module the first time it imports it, and the NeMo adapter on an Apple M5
 * became ready in 15.3 s without its bytecode and in 9.5 s with it (2026-10-30).
 */
export function syncAdapter(adapter: Adapter): void {
  process.stderr.write(`  installing the Python packages of the ${adapter.id} adapter, once\n`)
  const synced = spawnSync('uv', ['sync', '--frozen', '--compile-bytecode', '--project', folderOf(adapter)], { env: { ...process.env, ...environmentOf(adapter) }, encoding: 'utf8', windowsHide: true })
  if (synced.error) throw new Error(`the ${adapter.id} adapter runs through uv, which could not be started (${synced.error.message}); install uv from https://docs.astral.sh/uv/`)
  if (synced.status !== 0) throw new Error(`uv could not install the ${adapter.id} adapter's packages:\n${synced.stderr}`)
}

/**
 * The worker command that runs the adapter's script with `args`, in its own environment. The bench gives it the
 * paths of the weights it verified, and Hugging Face's libraries are kept offline, so that a file the implementation
 * would fetch by repository name stops it instead.
 */
export const adapterCommand = (adapter: Adapter, name: string, args: readonly string[]): WorkerCommand => ({
  name,
  executable: 'uv',
  // --no-sync implies --frozen: the worker runs in the environment syncAdapter() installed from the lock file.
  args: ['run', '--no-sync', '--project', folderOf(adapter), 'python', adapterScript(adapter), ...args],
  env: { ...environmentOf(adapter), HF_HUB_OFFLINE: '1' },
  readySeconds: adapter.readySeconds
})
