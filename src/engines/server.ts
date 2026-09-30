import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { logsDir } from '../paths.ts'

const HEALTH_POLL_MS = 250

/**
 * Loading a model and compiling its GPU kernels comes before a server answers its health check. The first
 * start of llama.cpp's Vulkan build compiled shaders for seconds on an RTX 2080 (ASIST, 2026-09-29).
 */
const READY_TIMEOUT_MS = 180_000

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

/** A server process the bench started, with its output kept in a log file rather than on the terminal. */
export interface RunningServer {
  child: ChildProcess
  port: number
  log: string
}

export async function startServer(name: string, command: string, args: (port: number) => string[]): Promise<RunningServer> {
  const port = await freePort()
  fs.mkdirSync(logsDir(), { recursive: true })
  const log = path.join(logsDir(), `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
  const output = fs.openSync(log, 'a')
  const child = spawn(command, args(port), { cwd: path.dirname(command), stdio: ['ignore', output, output], windowsHide: true })
  fs.closeSync(output)
  return { child, port, log }
}

/**
 * Waits until url answers with a success, and fails as soon as the process exits, so that a server that
 * cannot start is reported with its log instead of after the whole timeout.
 */
export async function waitUntilHealthy(server: RunningServer, url: string, headers: Record<string, string> = {}): Promise<Response> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) throw new Error(`the server exited with code ${server.child.exitCode}; see ${server.log}`)
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(2_000) })
      if (response.ok) return response
    } catch {
      // Not listening yet, or still loading the model.
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS))
  }
  throw new Error(`the server did not become ready in ${READY_TIMEOUT_MS / 1000} s; see ${server.log}`)
}

export function stopServer(server: RunningServer): Promise<void> {
  if (server.child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    server.child.once('exit', () => resolve())
    server.child.kill('SIGTERM')
  })
}
