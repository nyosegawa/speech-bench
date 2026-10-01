import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'

const REPORT_EVERY_MS = 2_000

/**
 * Downloads url to target through a temporary name and renames it into place only when its sha256 is the
 * pinned one, so a file at target is always whole. Model files run to gigabytes, so the body is hashed
 * while it streams to disk instead of being held in memory.
 */
export async function downloadVerified(url: string, target: string, sha256: string): Promise<void> {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const partial = `${target}.partial`
  // fetch reports a dropped connection as "fetch failed" with the reason in its cause, and names no URL.
  const failed = (error: unknown): Error => {
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : ''
    return new Error(`downloading ${url} failed (${error instanceof Error ? error.message : String(error)}${cause}); run the command again to retry`, { cause: error })
  }
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    throw failed(error)
  }
  if (!response.ok || !response.body) throw new Error(`${url} answered HTTP ${response.status}`)
  const total = Number(response.headers.get('content-length')) || 0
  const hash = createHash('sha256')
  let received = 0
  let reported = Date.now()
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk)
      received += chunk.length
      if (Date.now() - reported >= REPORT_EVERY_MS) {
        reported = Date.now()
        const share = total > 0 ? ` (${Math.round((received / total) * 100)}%)` : ''
        process.stderr.write(`  ${path.basename(target)}: ${(received / 1e6).toFixed(0)} MB${share}\n`)
      }
      done(null, chunk)
    }
  })
  try {
    await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), counter, fs.createWriteStream(partial))
  } catch (error) {
    fs.rmSync(partial, { force: true })
    throw failed(error)
  }
  const actual = hash.digest('hex')
  if (actual !== sha256) {
    fs.rmSync(partial, { force: true })
    throw new Error(`${url} has sha256 ${actual}, not the pinned ${sha256}`)
  }
  fs.renameSync(partial, target)
}

export async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(fs.createReadStream(file), hash)
  return hash.digest('hex')
}

// The tar.exe of Windows is bsdtar, which reads zip like the tar of macOS. The GNU tar of Git Bash, often
// first on a developer's PATH, cannot.
function tarCommand(): string {
  if (process.platform !== 'win32') return 'tar'
  if (!process.env.SystemRoot) throw new Error('SystemRoot is not set, so the tar.exe of Windows cannot be found')
  return path.join(process.env.SystemRoot, 'System32', 'tar.exe')
}

/** Unpacks a .tar.gz or .zip archive into dir, or only the named members of it. */
export function extractArchive(archive: string, dir: string, members: string[] = []): void {
  fs.mkdirSync(dir, { recursive: true })
  execFileSync(tarCommand(), ['-xf', archive, '-C', dir, ...members], { stdio: 'inherit', windowsHide: true })
}
