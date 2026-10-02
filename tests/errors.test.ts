import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { describeError } from '../src/core/errors.ts'

describe('describeError', () => {
  it('names why a request to a local server failed, which fetch keeps only in its cause', async () => {
    const closed = net.createServer((socket) => socket.destroy())
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const { port } = closed.address() as net.AddressInfo
    const error = await fetch(`http://127.0.0.1:${port}/`).then(() => null, (failed: unknown) => failed)
    closed.close()
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
