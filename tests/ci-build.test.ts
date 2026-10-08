import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ciArchiveArtifact, ciArchiveVersion, ciBuildCommit, ciRunOf, ensureSpeechCppCiBuild, type CiArtifactList, type CiRunView, type Gh } from '../src/catalog/ci-build.ts'

const COMMIT = 'f5ab84c1710d919ad68293b6ff8897444d832939'
const RUN = 37705728430

const view = (fields: Partial<CiRunView> = {}): CiRunView => ({
  event: 'push',
  headSha: COMMIT,
  workflowName: 'build',
  jobs: [
    { name: 'macos-metal', status: 'completed', conclusion: 'success' },
    { name: 'windows-vulkan', status: 'completed', conclusion: 'success' }
  ],
  ...fields
})

const artifact = (name: string, fields: Partial<CiArtifactList['artifacts'][number]> = {}): CiArtifactList['artifacts'][number] =>
  ({ id: 11, name, expired: false, digest: `sha256:${'a'.repeat(64)}`, workflow_run: { head_sha: COMMIT }, ...fields })

describe('ciRunOf', () => {
  it('reads the run id after ci:, takes anything else for a build directory, and refuses ci: without a run id', () => {
    expect(ciRunOf(`ci:${RUN}`)).toBe(RUN)
    expect(ciRunOf(path.join('speech.cpp', 'build'))).toBeNull()
    expect(() => ciRunOf('ci:latest')).toThrow(/names no run/)
  })
})

describe('ciBuildCommit', () => {
  it('takes the head of a run of a push or one started by hand whose job for the system passed', () => {
    expect(ciBuildCommit(RUN, view(), 'win32-x64')).toBe(COMMIT)
    expect(ciBuildCommit(RUN, view({ event: 'workflow_dispatch' }), 'darwin-arm64')).toBe(COMMIT)
  })

  it('refuses a run of a pull request, which builds a merge commit rather than its head', () => {
    expect(() => ciBuildCommit(RUN, view({ event: 'pull_request' }), 'win32-x64')).toThrow(/pull request/)
  })

  it('refuses a run whose job for the system has not passed, even when the other system\'s has', () => {
    const jobs = [{ name: 'macos-metal', status: 'completed', conclusion: 'success' }, { name: 'windows-vulkan', status: 'in_progress', conclusion: '' }]
    expect(ciBuildCommit(RUN, view({ jobs }), 'darwin-arm64')).toBe(COMMIT)
    expect(() => ciBuildCommit(RUN, view({ jobs }), 'win32-x64')).toThrow(/windows-vulkan/)
  })

  it('refuses a run of another workflow', () => {
    expect(() => ciBuildCommit(RUN, view({ workflowName: 'docs' }), 'win32-x64')).toThrow(/not build/)
  })
})

describe('ciArchiveArtifact', () => {
  it('takes the artifact of the system with the sha256 GitHub gives of it', () => {
    const list = { artifacts: [artifact('speech-macos-arm64-metal', { id: 1 }), artifact('speech-windows-x64-vulkan', { id: 2, digest: `sha256:${'b'.repeat(64)}` })] }
    expect(ciArchiveArtifact(RUN, list, 'win32-x64', COMMIT)).toEqual({ id: 2, sha256: 'b'.repeat(64) })
  })

  it('refuses an artifact that is not the run\'s commit, has expired, has no digest, or is one of two', () => {
    const name = 'speech-windows-x64-vulkan'
    expect(() => ciArchiveArtifact(RUN, { artifacts: [artifact(name, { workflow_run: { head_sha: '0'.repeat(40) } })] }, 'win32-x64', COMMIT)).toThrow(/not the run's commit/)
    expect(() => ciArchiveArtifact(RUN, { artifacts: [artifact(name, { expired: true })] }, 'win32-x64', COMMIT)).toThrow(/expired/)
    expect(() => ciArchiveArtifact(RUN, { artifacts: [artifact(name, { digest: null })] }, 'win32-x64', COMMIT)).toThrow(/no sha256/)
    expect(() => ciArchiveArtifact(RUN, { artifacts: [artifact(name), artifact(name, { id: 12 })] }, 'win32-x64', COMMIT)).toThrow(/2 artifacts/)
    expect(() => ciArchiveArtifact(RUN, { artifacts: [artifact('speech-macos-arm64-metal')] }, 'win32-x64', COMMIT)).toThrow(/no artifact/)
  })
})

describe('ciArchiveVersion', () => {
  it('reads the release number from the name of the one archive of the system', () => {
    expect(ciArchiveVersion(['speech-0.8.0-windows-x64-vulkan.zip'], 'win32-x64')).toBe('0.8.0')
  })

  it('refuses the archive of another system and an artifact of more than one file', () => {
    expect(() => ciArchiveVersion(['speech-0.8.0-macos-arm64-metal.zip'], 'win32-x64')).toThrow(/not one archive/)
    expect(() => ciArchiveVersion(['speech-0.8.0-windows-x64-vulkan.zip', 'speech-checks.zip'], 'win32-x64')).toThrow(/not one archive/)
  })
})

describe('ensureSpeechCppCiBuild', () => {
  let folder: string
  let data: string

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-ci-'))
    data = path.join(folder, 'data')
    process.env.SPEECH_BENCH_DATA = data
  })
  afterEach(() => {
    delete process.env.SPEECH_BENCH_DATA
    fs.rmSync(folder, { recursive: true, force: true })
  })

  /** A gh that answers for one run, its artifacts and the download of the artifact, which is `zip`'s bytes. */
  const fakeGh = (zip: Buffer, digest: string): Gh => (args, output) => {
    if (args[0] === 'run' && args[1] === 'view') return JSON.stringify(view())
    if (args[0] === 'api' && args[1]!.endsWith('/artifacts?per_page=100')) return JSON.stringify({ artifacts: [artifact('speech-macos-arm64-metal', { digest: `sha256:${digest}` })] })
    if (args[0] === 'api' && args[1]!.endsWith('/zip') && output) {
      fs.writeFileSync(output, zip)
      return ''
    }
    throw new Error(`unexpected gh ${args.join(' ')}`)
  }
  const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

  /**
   * An artifact as GitHub serves it, a zip that holds speech-0.8.0-macos-arm64-metal.zip, in which a shell script
   * stands in for speech and prints the version given. The tar of macOS makes the zips.
   */
  const artifactZip = (reports: string): Buffer => {
    const archive = path.join(folder, 'archive')
    fs.mkdirSync(path.join(archive, 'inner'), { recursive: true })
    fs.writeFileSync(path.join(archive, 'inner', 'speech'), `#!/bin/sh\necho "${reports}"\n`, { mode: 0o755 })
    fs.writeFileSync(path.join(archive, 'inner', 'speech.h'), '')
    fs.mkdirSync(path.join(archive, 'outer'))
    execFileSync('tar', ['-a', '-cf', path.join(archive, 'outer', 'speech-0.8.0-macos-arm64-metal.zip'), '-C', path.join(archive, 'inner'), 'speech', 'speech.h'])
    execFileSync('tar', ['-a', '-cf', path.join(archive, 'artifact.zip'), '-C', path.join(archive, 'outer'), 'speech-0.8.0-macos-arm64-metal.zip'])
    return fs.readFileSync(path.join(archive, 'artifact.zip'))
  }

  it('refuses an artifact whose bytes are not the ones GitHub gives the sha256 of, and keeps nothing of it', async () => {
    const zip = Buffer.from('not the artifact')
    await expect(ensureSpeechCppCiBuild(RUN, 'darwin-arm64', fakeGh(zip, 'c'.repeat(64)))).rejects.toThrow(/sha256/)
    expect(fs.readdirSync(path.join(data, 'runtimes'))).toEqual([])
  })

  it.skipIf(process.platform === 'win32')('unpacks the archive inside the artifact and records the release number speech reports with the run\'s commit', async () => {
    const zip = artifactZip('speech.cpp 0.8.0, C API 3.1')
    const executable = path.join(data, 'runtimes', `speech.cpp-ci-${RUN}`, 'speech')
    expect(await ensureSpeechCppCiBuild(RUN, 'darwin-arm64', fakeGh(zip, sha256(zip)))).toEqual({ executable, version: '0.8.0', commit: COMMIT })
    const runOnly: Gh = (args) => {
      if (args[0] === 'run' && args[1] === 'view') return JSON.stringify(view())
      throw new Error(`the build of run ${RUN} is downloaded again: gh ${args.join(' ')}`)
    }
    expect(await ensureSpeechCppCiBuild(RUN, 'darwin-arm64', runOnly)).toEqual({ executable, version: '0.8.0', commit: COMMIT })
  })

  it.skipIf(process.platform === 'win32')('refuses an archive whose speech reports another release number than its name', async () => {
    const zip = artifactZip('speech.cpp 0.7.1, C API 3.1')
    await expect(ensureSpeechCppCiBuild(RUN, 'darwin-arm64', fakeGh(zip, sha256(zip)))).rejects.toThrow(/reports 0\.7\.1/)
    expect(fs.existsSync(path.join(data, 'runtimes', `speech.cpp-ci-${RUN}`))).toBe(false)
  })
})
