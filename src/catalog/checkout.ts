import { spawnSync, type StdioOptions } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Runs a command to its end and returns its stdout, failing with what it wrote. With `shown`, what it writes goes to
 * the bench's stderr as it runs instead, for a build or a conversion that takes minutes, and nothing is returned.
 */
export function run(command: string, args: readonly string[], options: { cwd?: string; env?: Readonly<Record<string, string>>; shown?: boolean } = {}): string {
  const stdio: StdioOptions = options.shown ? ['ignore', 2, 2] : 'pipe'
  const result = spawnSync(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio })
  if (result.error) throw new Error(`${command} could not be started (${result.error.message}); install it and run the command again`, { cause: result.error })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed${options.shown ? ' (its output is above)' : `:\n${result.stderr || result.stdout}`}`)
  return options.shown ? '' : result.stdout.trim()
}

/**
 * A repository at a commit, with the submodules named checked out at the commits it pins, fetched once into `folder`
 * with git, which checks what it fetched against the commit's hash. The folder is renamed into place only once checked
 * out.
 */
export function ensureCheckout(repository: string, commit: string, submodules: readonly string[], folder: string): string {
  if (fs.existsSync(folder)) return folder
  process.stderr.write(`  fetching ${repository} at ${commit.slice(0, 12)}\n`)
  fs.mkdirSync(path.dirname(folder), { recursive: true })
  const work = fs.mkdtempSync(path.join(path.dirname(folder), '.work-'))
  try {
    const checkout = path.join(work, 'source')
    // Nothing the bench builds or converts reads the files kept in Git LFS, which a checkout would otherwise download.
    const env = { GIT_LFS_SKIP_SMUDGE: '1' }
    run('git', ['init', '-q', checkout], { env })
    run('git', ['-C', checkout, 'fetch', '-q', '--depth', '1', repository, commit], { env })
    run('git', ['-C', checkout, 'checkout', '-q', '--detach', 'FETCH_HEAD'], { env })
    const head = run('git', ['-C', checkout, 'rev-parse', 'HEAD'])
    if (head !== commit) throw new Error(`fetching ${commit} of ${repository} checked out ${head}`)
    if (submodules.length > 0) run('git', ['-C', checkout, 'submodule', 'update', '--init', '--depth', '1', '--', ...submodules], { env })
    fs.renameSync(checkout, folder)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
  return folder
}
