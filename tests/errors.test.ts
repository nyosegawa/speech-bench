import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { describeError } from '../src/core/errors.ts'

describe('describeError', () => {
  it('names why a request to a local server failed, which fetch keeps only in its cause', async () => {
    // Answering the request with what is not HTTP fails fetch on both systems. Closing the connection at once left
    // fetch waiting past the test's timeout on GitHub's windows-2025 (2026-10-02).
    const server = net.createServer((socket) => socket.once('data', () => socket.end('not http\r\n\r\n')))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as net.AddressInfo
    const error = await fetch(`http://127.0.0.1:${port}/`).then(() => null, (failed: unknown) => failed)
    server.close()
    const wrapped = new Error(`qwen3-asr-0.6b failed: ${(error as Error).message}`, { cause: error })
    const described = describeError(wrapped)
    expect(described.startsWith('qwen3-asr-0.6b failed: fetch failed')).toBe(true)
    expect(described.split('\n')).toHaveLength(2)
    expect(described).not.toMatch(/caused by: fetch failed/)
  })

  it('gives each reason of an AggregateError, and a thrown value that is not an error', () => {
    expect(describeError(new AggregateError([new Error('connect ECONNREFUSED ::1:80'), new Error('connect ECONNREFUSED 127.0.0.1:80')], ''))).toBe('connect ECONNREFUSED ::1:80\n  caused by: connect ECONNREFUSED 127.0.0.1:80')
    expect(describeError('no model')).toBe('no model')
  })
})
