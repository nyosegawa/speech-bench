import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { runtimesDir } from '../core/paths.ts'
import type { PlatformKey } from '../core/platform.ts'
import { check, parseJsonObject } from '../core/stored.ts'
import { extractArchive, sha256Of } from './download.ts'
import { SPEECH_CPP_BUILD_VARIABLE, speechVersionOf, type SpeechCppBuild } from './local-build.ts'

/** The repository whose workflow `build` packs speech.cpp's release archive on every run. */
export const SPEECH_CPP_REPOSITORY = 'nyosegawa/speech.cpp'

/**
 * For each system, the job of speech.cpp's workflow that packs its archive and the name of the system in the archive's
 * name, `speech-<VERSION>-<system>.zip`, and in its artifact's, `speech-<system>`.
 */
const CI_ARCHIVES: Record<PlatformKey, { job: string; system: string }> = {
  'darwin-arm64': { job: 'macos-metal', system: 'macos-arm64-metal' },
  'win32-x64': { job: 'windows-vulkan', system: 'windows-x64-vulkan' }
}

/** The run of speech.cpp's CI that the variable names as `ci:<run id>`, or null for a build directory. */
export function ciRunOf(value: string): number | null {
  if (!value.startsWith('ci:')) return null
  const id = value.slice('ci:'.length)
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    throw new Error(`${SPEECH_CPP_BUILD_VARIABLE}=${value} names no run; give the id of a run of speech.cpp's CI as ci:<run id>, which gh run list -R ${SPEECH_CPP_REPOSITORY} --workflow build lists`)
  }
  return Number(id)
}

/** What `gh run view --json event,headSha,workflowName,jobs` says of a run, as far as the bench reads it. */
const runView = z.object({
  event: z.string(),
  headSha: z.string(),
  workflowName: z.string(),
  jobs: z.array(z.object({ name: z.string(), status: z.string(), conclusion: z.string() }))
})
export type CiRunView = z.infer<typeof runView>

/**
 * The commit a run of speech.cpp's CI built this system's archive from: the run's head, for a run of a push or one
 * started by hand. A run of a pull request checks out the merge of its branch into the base, a commit no branch keeps,
 * so its head does not name what it built.
 */
export function ciBuildCommit(run: number, view: CiRunView, platform: PlatformKey): string {
  const where = `run ${run} of ${SPEECH_CPP_REPOSITORY}`
  if (view.workflowName !== 'build') throw new Error(`${where} is of the workflow ${view.workflowName}, not build, which packs speech.cpp's archives`)
  if (view.event === 'pull_request') {
    throw new Error(`${where} ran for a pull request, which builds the merge of the branch into its base rather than the branch's head ${view.headSha.slice(0, 12)}; measure a run started on the branch with gh workflow run build -R ${SPEECH_CPP_REPOSITORY} --ref <branch>, or the run of a push`)
  }
  if (view.event !== 'push' && view.event !== 'workflow_dispatch') throw new Error(`${where} ran for a ${view.event} event; the bench takes the run of a push or one started by hand, which build their head`)
  const { job } = CI_ARCHIVES[platform]
  const ran = view.jobs.find((candidate) => candidate.name === job)
  if (!ran) throw new Error(`${where} has no job ${job}, which packs the archive for ${platform}`)
  if (ran.conclusion !== 'success') throw new Error(`the job ${job} of ${where} is ${ran.status}${ran.conclusion ? ` with ${ran.conclusion}` : ''}; the bench takes an archive whose job passed`)
  if (!/^[0-9a-f]{40}$/.test(view.headSha)) throw new Error(`${where} names ${JSON.stringify(view.headSha)} as its commit`)
  return view.headSha
}

/** What GitHub lists of a run's artifacts, as far as the bench reads it. */
const artifactList = z.object({
  artifacts: z.array(z.object({
    id: z.number(),
    name: z.string(),
    expired: z.boolean(),
    /** The sha256 of the artifact's zip, as `sha256:<hex>`. */
    digest: z.string().nullish(),
    workflow_run: z.object({ head_sha: z.string() })
  }))
})
export type CiArtifactList = z.infer<typeof artifactList>

/** The artifact that holds this system's archive, with the sha256 GitHub gives of it, refusing any that is not exactly one. */
export function ciArchiveArtifact(run: number, list: CiArtifactList, platform: PlatformKey, commit: string): { id: number; sha256: string } {
  const name = `speech-${CI_ARCHIVES[platform].system}`
  const named = list.artifacts.filter((artifact) => artifact.name === name)
  if (named.length !== 1) throw new Error(`run ${run} of ${SPEECH_CPP_REPOSITORY} has ${named.length === 0 ? 'no artifact' : `${named.length} artifacts`} named ${name}`)
  const artifact = named[0]!
  if (artifact.expired) throw new Error(`the artifact ${name} of run ${run} has expired; start the workflow again on the same commit and measure that run`)
  if (artifact.workflow_run.head_sha !== commit) throw new Error(`the artifact ${name} of run ${run} was built from ${artifact.workflow_run.head_sha}, not the run's commit ${commit}`)
  const sha256 = /^sha256:([0-9a-f]{64})$/.exec(artifact.digest ?? '')?.[1]
  if (!sha256) throw new Error(`GitHub gives no sha256 of the artifact ${name} of run ${run}, so what is downloaded cannot be checked`)
  return { id: artifact.id, sha256 }
}

/** The release number in the name of the one archive an artifact holds, `speech-<VERSION>-<system>.zip`. */
export function ciArchiveVersion(names: readonly string[], platform: PlatformKey): string {
  const { system } = CI_ARCHIVES[platform]
  const [only] = names
  const version = names.length === 1 && only!.startsWith('speech-') && only!.endsWith(`-${system}.zip`) ? only!.slice('speech-'.length, -`-${system}.zip`.length) : ''
  if (!/^\d+\.\d+\.\d+\S*$/.test(version)) throw new Error(`the artifact holds ${names.join(', ') || 'nothing'}, not one archive speech-<version>-${system}.zip`)
  return version
}

/** Runs gh with the arguments and returns what it prints, or writes that to `output` and returns nothing. */
export type Gh = (args: readonly string[], output?: string) => string

const ghCli: Gh = (args, output) => {
  const descriptor = output === undefined ? null : fs.openSync(output, 'w')
  try {
    const result = spawnSync('gh', args, { encoding: 'utf8', stdio: ['ignore', descriptor ?? 'pipe', 'pipe'], windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
    if (result.error) throw new Error(`gh could not be started (${result.error.message}); install GitHub CLI and log in with gh auth login`, { cause: result.error })
    if (result.status !== 0) throw new Error(`gh ${args.join(' ')} failed: ${result.stderr.trim()}; check the run id and that gh is logged in (gh auth status)`)
    return result.stdout ?? ''
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor)
  }
}

const executableName = (platform: PlatformKey): string => (platform === 'win32-x64' ? 'speech.exe' : 'speech')

/**
 * Downloads the run's archive for this system, checks it against the sha256 GitHub gives, and unpacks it into
 * `folder`, renamed into place only once the speech inside reports the release number the archive's name gives.
 */
async function downloadCiBuild(run: number, commit: string, platform: PlatformKey, folder: string, gh: Gh): Promise<void> {
  const list = check(artifactList, parseJsonObject(gh(['api', `repos/${SPEECH_CPP_REPOSITORY}/actions/runs/${run}/artifacts?per_page=100`]), `the artifacts of run ${run}`), `the artifacts of run ${run}`)
  const artifact = ciArchiveArtifact(run, list, platform, commit)
  process.stderr.write(`  downloading speech.cpp's CI build of ${commit.slice(0, 12)} from run ${run}\n`)
  // The work folder sits beside the target, because a rename across volumes fails.
  fs.mkdirSync(runtimesDir(), { recursive: true })
  const work = fs.mkdtempSync(path.join(runtimesDir(), '.work-'))
  try {
    const zip = path.join(work, 'artifact.zip')
    gh(['api', `repos/${SPEECH_CPP_REPOSITORY}/actions/artifacts/${artifact.id}/zip`], zip)
    const sha256 = await sha256Of(zip)
    if (sha256 !== artifact.sha256) throw new Error(`the artifact of run ${run} downloaded with sha256 ${sha256}, not the ${artifact.sha256} GitHub gives; run the command again to retry`)
    // GitHub wraps the uploaded archive in a zip of its own.
    const wrapped = path.join(work, 'artifact')
    extractArchive(zip, wrapped)
    const names = fs.readdirSync(wrapped)
    const version = ciArchiveVersion(names, platform)
    const unpacked = path.join(work, 'unpacked')
    extractArchive(path.join(wrapped, names[0]!), unpacked)
    const executable = path.join(unpacked, executableName(platform))
    if (!fs.existsSync(executable)) throw new Error(`${names[0]} of run ${run} has no ${executableName(platform)}`)
    const reported = speechVersionOf(executable)
    if (reported !== version) throw new Error(`${names[0]} of run ${run} holds a speech that reports ${reported}, not ${version}`)
    fs.renameSync(unpacked, folder)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

/**
 * The build of speech.cpp that a run of its CI packed for this system, downloaded once into a folder of its own and
 * kept by the run's id. The run is asked of GitHub for each use, so that the commit a result records is always the
 * one GitHub gives for the run.
 */
export async function ensureSpeechCppCiBuild(run: number, platform: PlatformKey, gh: Gh = ghCli): Promise<SpeechCppBuild> {
  const place = `run ${run} of ${SPEECH_CPP_REPOSITORY}`
  const view = check(runView, parseJsonObject(gh(['run', 'view', String(run), '-R', SPEECH_CPP_REPOSITORY, '--json', 'event,headSha,workflowName,jobs']), place), place)
  const commit = ciBuildCommit(run, view, platform)
  const folder = path.join(runtimesDir(), `speech.cpp-ci-${run}`)
  const executable = path.join(folder, executableName(platform))
  if (!fs.existsSync(folder)) await downloadCiBuild(run, commit, platform, folder, gh)
  else if (!fs.existsSync(executable)) throw new Error(`${folder} has no ${executableName(platform)}; remove the folder to download the build again`)
  return { executable, version: speechVersionOf(executable), commit }
}
