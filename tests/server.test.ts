import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { stopServer, type RunningServer } from '../src/engines/server.ts'

describe('stopServer', () => {
  it('stops a server, and then resolves at once for the server it stopped', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    await new Promise((resolve) => child.once('spawn', resolve))
    const server: RunningServer = { child, port: 0, log: '' }
    await stopServer(server)
    expect(child.signalCode).toBe('SIGTERM')
    const again = await Promise.race([stopServer(server).then(() => 'stopped'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 2000))])
    expect(again).toBe('stopped')
  })
})
