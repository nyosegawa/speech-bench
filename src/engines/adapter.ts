import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../core/paths.ts'
import type { WorkerCommand } from './worker.ts'

/**
 * A model's official implementation run in an adapter of the bench's own, `adapters/<id>/`, which speaks
 * speech.cpp's worker protocol 3: a Python project whose lock file pins every package, and the package of the
 * implementation, whose pinned commit is the runtime's version.
 */
export interface Adapter {
  id: string
  /** The package of the implementation, named in the project's dependencies with the commit it is pinned to. */
  implementation: string
  script: string
}

export const IRODORI_TTS_ADAPTER: Adapter = { id: 'irodori-tts', implementation: 'irodori-tts', script: 'worker.py' }

/** mlx-audio, which runs ports of many models on Apple's MLX, here for its Irodori-TTS. */
export const MLX_AUDIO_ADAPTER: Adapter = { id: 'mlx-audio', implementation: 'mlx-audio', script: 'worker.py' }

const folderOf = (adapter: Adapter): string => path.join(import.meta.dirname, '..', '..', 'adapters', adapter.id)

/** The adapter's Python environment, in the data folder with the other downloads rather than in the repository. */
const environmentOf = (adapter: Adapter): Record<string, string> => ({ UV_PROJECT_ENVIRONMENT: path.join(dataDir(), 'adapters', adapter.id) })

/** The commit of the implementation the adapter's project pins, shortened as a version. */
export function adapterVersion(adapter: Adapter): string {
  const project = fs.readFileSync(path.join(folderOf(adapter), 'pyproject.toml'), 'utf8')
  const pinned = new RegExp(`"${adapter.implementation} @ git\\+[^@"]+@([0-9a-f]{40})"`).exec(project)
  if (!pinned) throw new Error(`adapters/${adapter.id}/pyproject.toml does not pin ${adapter.implementation} to a commit`)
  return pinned[1]!.slice(0, 12)
}

/**
 * Installs the packages the adapter's lock file pins, which on the first run downloads PyTorch, and does nothing
 * once they are installed. It runs before the worker starts, so that installing is not timed as loading.
 */
export function syncAdapter(adapter: Adapter): void {
  process.stderr.write(`  installing the Python packages of the ${adapter.id} adapter, once\n`)
  const synced = spawnSync('uv', ['sync', '--frozen', '--project', folderOf(adapter)], { env: { ...process.env, ...environmentOf(adapter) }, encoding: 'utf8', windowsHide: true })
  if (synced.error) throw new Error(`the ${adapter.id} adapter runs through uv, which could not be started (${synced.error.message}); install uv from https://docs.astral.sh/uv/`)
  if (synced.status !== 0) throw new Error(`uv could not install the ${adapter.id} adapter's packages:\n${synced.stderr}`)
}

/** The worker command that runs the adapter's script with `args`, in its own environment. */
export const adapterCommand = (adapter: Adapter, name: string, args: readonly string[]): WorkerCommand => ({
  name,
  executable: 'uv',
  // --no-sync alone: it implies --frozen, and uv 0.4.24 refuses the two together.
  args: ['run', '--no-sync', '--project', folderOf(adapter), 'python', path.join(folderOf(adapter), adapter.script), ...args],
  env: environmentOf(adapter)
})
