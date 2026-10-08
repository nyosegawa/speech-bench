import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { PlatformKey } from '../core/platform.ts'

/**
 * The variable that names a build of speech.cpp run in place of the pinned release, so that a release candidate is
 * measured before it is released: a CMake build directory, or a run of speech.cpp's CI as `ci:<run id>`.
 */
export const SPEECH_CPP_BUILD_VARIABLE = 'SPEECH_BENCH_SPEECH_CPP'

/** The entries of a CMakeCache.txt by name, each line `NAME:TYPE=VALUE`, the comments left out. */
export function parseCMakeCache(text: string): Map<string, string> {
  const entries = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const entry = /^([^#/:=][^:=]*):[A-Z_]+=(.*)$/.exec(line)
    if (entry) entries.set(entry[1]!, entry[2]!)
  }
  return entries
}

/**
 * Where a build directory of speech.cpp keeps `speech` and the source it was configured from, refusing a directory
 * of another project and a build that is not Release.
 */
export function speechCppBuildLayout(directory: string, cache: ReadonlyMap<string, string>, platform: PlatformKey): { executable: string; source: string } {
  const project = cache.get('CMAKE_PROJECT_NAME')
  if (project !== 'speech-cpp') throw new Error(`${directory} is a build of ${project ?? 'no CMake project'}, not of speech.cpp; ${SPEECH_CPP_BUILD_VARIABLE} names the folder that cmake -B made in a checkout of speech.cpp`)
  const source = cache.get('CMAKE_HOME_DIRECTORY')
  if (!source) throw new Error(`${path.join(directory, 'CMakeCache.txt')} does not name the source it was configured from`)
  // speech.cpp's CMakeLists.txt builds Release when no type is given, which leaves the cache's entry empty.
  const type = cache.get('CMAKE_BUILD_TYPE')
  if (type && type !== 'Release') throw new Error(`${directory} is a ${type} build; configure a Release build to measure, as a release is built`)
  // A generator of several configurations (Visual Studio, Xcode) puts each configuration's executables in a folder of its own.
  const folder = cache.has('CMAKE_CONFIGURATION_TYPES') ? path.join(directory, 'Release') : directory
  return { executable: path.join(folder, platform === 'win32-x64' ? 'speech.exe' : 'speech'), source: path.resolve(source) }
}

/** The release number in what `speech --version` prints, `speech.cpp 0.7.1, C API 3.1`, or null for anything else. */
export function parseSpeechVersion(output: string): string | null {
  return /^speech\.cpp (\d+\.\d+\.\d+\S*), C API \d+\.\d+$/.exec(output.trim())?.[1] ?? null
}

const run = (command: string, args: readonly string[]): string => execFileSync(command, args, { encoding: 'utf8', windowsHide: true }).trim()

/** The release number a build of speech.cpp reports, refusing an executable that is not speech.cpp's. */
export function speechVersionOf(executable: string): string {
  const version = parseSpeechVersion(run(executable, ['--version']))
  if (version === null) throw new Error(`${executable} --version does not print speech.cpp's version; ${SPEECH_CPP_BUILD_VARIABLE} names a build of speech.cpp`)
  return version
}

/** A build of speech.cpp: its executable, the release number it reports and the commit it was built from. */
export interface SpeechCppBuild {
  executable: string
  version: string
  commit: string
}

/**
 * The build of speech.cpp in `directory`, checked to be one, with the commit its source has checked out. A source
 * with changes that are not committed is refused, since no commit would name what was built. Whether the executable
 * was built after the last checkout cannot be told from the directory; it is built before it is measured.
 */
export function readSpeechCppBuild(directory: string, platform: PlatformKey): SpeechCppBuild {
  const folder = path.resolve(directory)
  const cacheFile = path.join(folder, 'CMakeCache.txt')
  if (!fs.existsSync(cacheFile)) throw new Error(`${folder} has no CMakeCache.txt; ${SPEECH_CPP_BUILD_VARIABLE} names the folder that cmake -B made in a checkout of speech.cpp`)
  const { executable, source } = speechCppBuildLayout(folder, parseCMakeCache(fs.readFileSync(cacheFile, 'utf8')), platform)
  if (!fs.existsSync(executable)) throw new Error(`${folder} has no ${path.relative(folder, executable)}; build it with cmake --build ${folder} --config Release`)
  let commit: string
  try {
    commit = run('git', ['-C', source, 'rev-parse', 'HEAD'])
  } catch (error) {
    throw new Error(`the source of ${folder}, ${source}, is not a git checkout, so no commit names the build; build speech.cpp from a clone`, { cause: error })
  }
  const changed = run('git', ['-C', source, 'status', '--porcelain', '--untracked-files=no'])
  if (changed !== '') throw new Error(`${source} has changes that are not committed, so commit ${commit.slice(0, 12)} does not name what ${folder} was built from; commit them, build again and measure:\n${changed}`)
  return { executable, version: speechVersionOf(executable), commit }
}
