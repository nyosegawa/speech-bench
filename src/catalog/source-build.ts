import fs from 'node:fs'
import path from 'node:path'
import { dataDir, runtimesDir } from '../core/paths.ts'
import { platformKey, type PlatformKey } from '../core/platform.ts'
import { ensureCheckout, run } from './checkout.ts'

/** How a runtime is built on one system: the CMake preset, the definitions after it and the folder it builds in. */
interface SourcePreset {
  preset: string
  definitions: readonly string[]
  /** The preset's build folder, relative to the checkout, which `cmake --install` installs from. */
  buildDir: string
}

/**
 * A runtime that no release offers yet, built by the bench from a pinned commit of its repository with the CMake and
 * Ninja that the uv project `builders/<id>/` of this repository locks and the system's C and C++ compilers.
 */
export interface SourceBuildSpec {
  id: string
  repository: string
  commit: string
  submodules: readonly string[]
  /** Scripts of the repository run with bash before configuring, which build dependencies inside the checkout. */
  prepare: readonly string[]
  presets: Partial<Record<PlatformKey, SourcePreset>>
  /** The executable in the installed tree. */
  executable: string
}

/**
 * Jobs of a build, here and in a converter that builds a tool. A bounded number leaves cores to whatever else runs on
 * the machine, which may be a measurement: NeMo-Speech.cpp's metal-server preset built in 2 minutes with 6 on an Apple
 * M5 (2026-10-29).
 */
export const BUILD_JOBS = 6

const projectOf = (spec: SourceBuildSpec): string => path.join(import.meta.dirname, '..', '..', 'builders', spec.id)

/** The folder a pinned commit is installed in, named by its commit, since no release names it. */
export const sourceBuildDir = (spec: Pick<SourceBuildSpec, 'id' | 'commit'>): string => path.join(runtimesDir(), `${spec.id}-${spec.commit.slice(0, 12)}`)

/** The preset of the runtime for `platform`, refusing a system the bench does not build it on. */
export function presetFor(spec: SourceBuildSpec, platform: PlatformKey): SourcePreset {
  const preset = spec.presets[platform]
  if (!preset) throw new Error(`the bench builds ${spec.id} ${spec.commit.slice(0, 12)} on ${Object.keys(spec.presets).join(' and ')}, not on ${platform}`)
  return preset
}

/**
 * The executable of the runtime built at its commit, building it first when it is not there: the repository fetched at
 * the commit with its submodules, the dependencies its scripts build, configured with its preset, built and installed
 * into a tree of its own, which is renamed into place only once its executable runs. The checkout and the build are
 * removed after, since the installed tree loads its libraries relative to itself.
 */
export function ensureSourceBuild(spec: SourceBuildSpec): string {
  const preset = presetFor(spec, platformKey())
  const folder = sourceBuildDir(spec)
  const executable = path.join(folder, ...spec.executable.split('/'))
  if (fs.existsSync(folder)) {
    if (!fs.existsSync(executable)) throw new Error(`${folder} has no ${spec.executable}; remove the folder to build ${spec.id} again`)
    return executable
  }
  const env = { UV_PROJECT_ENVIRONMENT: path.join(dataDir(), 'builders', `${spec.id}-environment`) }
  process.stderr.write(`  installing CMake and Ninja for building ${spec.id}, once\n`)
  run('uv', ['sync', '--frozen', '--project', projectOf(spec)], { env })
  // uv run puts the environment's CMake and Ninja first on the PATH of what it runs, the preset's own cmake calls and
  // the scripts' among them.
  const tool = (command: string, args: readonly string[], cwd: string): string =>
    run('uv', ['run', '--no-sync', '--project', projectOf(spec), command, ...args], { cwd, env: { ...env, JOBS: String(BUILD_JOBS) }, shown: true })
  fs.mkdirSync(runtimesDir(), { recursive: true })
  const work = fs.mkdtempSync(path.join(runtimesDir(), '.work-'))
  try {
    const source = ensureCheckout(spec.repository, spec.commit, spec.submodules, path.join(work, 'source'))
    process.stderr.write(`  building ${spec.id} ${spec.commit.slice(0, 12)} with the ${preset.preset} preset\n`)
    for (const script of spec.prepare) tool('bash', [path.join(source, ...script.split('/'))], source)
    tool('cmake', ['--preset', preset.preset, ...preset.definitions], source)
    tool('cmake', ['--build', '--preset', preset.preset, '--parallel', String(BUILD_JOBS)], source)
    const installed = path.join(work, 'installed')
    tool('cmake', ['--install', path.join(source, ...preset.buildDir.split('/')), '--prefix', installed], source)
    run(path.join(installed, ...spec.executable.split('/')), ['--version'])
    fs.renameSync(installed, folder)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
  return executable
}
