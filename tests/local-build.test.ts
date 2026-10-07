import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCMakeCache, parseSpeechVersion, readSpeechCppBuild, speechCppBuildLayout } from '../src/catalog/local-build.ts'

const cacheOf = (lines: string[]): Map<string, string> => parseCMakeCache(['# This is the CMakeCache file.', '//Name of the project', ...lines].join('\n'))
const speechCpp = (source: string, more: string[] = []): string[] => ['CMAKE_PROJECT_NAME:STATIC=speech-cpp', `CMAKE_HOME_DIRECTORY:INTERNAL=${source}`, 'CMAKE_BUILD_TYPE:STRING=', ...more]

describe('speechCppBuildLayout', () => {
  const source = path.resolve('speech.cpp')
  const build = path.join(source, 'build')

  it('finds speech in the build directory and the source the cache names', () => {
    expect(speechCppBuildLayout(build, cacheOf(speechCpp(source)), 'darwin-arm64')).toEqual({ executable: path.join(build, 'speech'), source })
  })

  it('finds speech.exe in the Release folder of a generator of several configurations', () => {
    const cache = cacheOf([...speechCpp(source), 'CMAKE_CONFIGURATION_TYPES:STRING=Debug;Release;MinSizeRel;RelWithDebInfo'])
    expect(speechCppBuildLayout(build, cache, 'win32-x64').executable).toBe(path.join(build, 'Release', 'speech.exe'))
  })

  it('refuses the build directory of another project', () => {
    const cache = cacheOf(['CMAKE_PROJECT_NAME:STATIC=nemo-speech', `CMAKE_HOME_DIRECTORY:INTERNAL=${source}`])
    expect(() => speechCppBuildLayout(build, cache, 'darwin-arm64')).toThrow(/not of speech\.cpp/)
  })

  it('refuses a build that is not Release', () => {
    const cache = cacheOf(['CMAKE_PROJECT_NAME:STATIC=speech-cpp', `CMAKE_HOME_DIRECTORY:INTERNAL=${source}`, 'CMAKE_BUILD_TYPE:STRING=Debug'])
    expect(() => speechCppBuildLayout(build, cache, 'darwin-arm64')).toThrow(/Debug build/)
  })
})

describe('parseSpeechVersion', () => {
  it('reads the release number speech --version prints, and nothing from another program', () => {
    expect(parseSpeechVersion('speech.cpp 0.7.1, C API 3.1\n')).toBe('0.7.1')
    expect(parseSpeechVersion('nemo-speech 0.2.0')).toBeNull()
  })
})

describe('readSpeechCppBuild', () => {
  let folder: string
  let source: string
  let build: string
  const git = (...args: string[]): string => execFileSync('git', ['-C', source, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', windowsHide: true }).trim()

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-build-'))
    source = path.join(folder, 'speech.cpp')
    build = path.join(source, 'build')
    fs.mkdirSync(build, { recursive: true })
    fs.writeFileSync(path.join(build, 'CMakeCache.txt'), speechCpp(source).join('\n'))
    // A shell script stands in for speech, which the tests never run on Windows.
    fs.writeFileSync(path.join(build, 'speech'), '#!/bin/sh\necho "speech.cpp 0.8.0, C API 3.1"\n', { mode: 0o755 })
    fs.writeFileSync(path.join(source, 'VERSION'), '0.8.0\n')
    fs.writeFileSync(path.join(source, '.gitignore'), 'build/\n')
    execFileSync('git', ['init', '-q', source], { windowsHide: true })
    git('add', '.')
    git('commit', '-q', '-m', 'Release 0.8.0')
  })
  afterEach(() => {
    fs.rmSync(folder, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'win32')('takes the release number the build prints and the commit its source has checked out', () => {
    expect(readSpeechCppBuild(build, 'darwin-arm64')).toEqual({ executable: path.join(build, 'speech'), version: '0.8.0', commit: git('rev-parse', 'HEAD') })
  })

  it('refuses a source with changes that are not committed, which no commit names', () => {
    fs.writeFileSync(path.join(source, 'VERSION'), '0.8.1\n')
    expect(() => readSpeechCppBuild(build, 'darwin-arm64')).toThrow(/changes that are not committed/)
  })

  it('refuses a folder that cmake did not configure', () => {
    expect(() => readSpeechCppBuild(source, 'darwin-arm64')).toThrow(/no CMakeCache\.txt/)
  })
})
