import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AsrModel } from '../src/catalog/models.ts'
import { encodeWav16, type Pcm } from '../src/core/wav.ts'
import { WorkerAsr } from '../src/engines/worker-asr.ts'

describe('WorkerAsr', () => {
  let data: string
  beforeEach(() => {
    data = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-test-'))
    process.env.SPEECH_BENCH_DATA = data
  })
  afterEach(() => {
    delete process.env.SPEECH_BENCH_DATA
    fs.rmSync(data, { recursive: true, force: true })
  })

  const fakeRecognizer = (steers: boolean, languageHint: AsrModel['languageHint']): WorkerAsr => new WorkerAsr(
    {
      name: 'fake',
      executable: process.execPath,
      args: [path.join(import.meta.dirname, 'fixtures', 'fake-recognizer.mjs')],
      env: { FAKE_WORKER_STEERS: String(steers) }
    },
    { id: 'fake', languageHint }
  )

  /** 2.5 s at 8 kHz whose first 16-bit sample is `first`, which picks how the fake answers. */
  const utterance = (first: number): Pcm => ({
    sampleRate: 8_000,
    samples: Float32Array.from({ length: 20_000 }, (_, index) => (index === 0 ? first / 32767 : index === 19_999 ? -0.25 : 0.1 * Math.sin(index / 5)))
  })

  /** Runs `use` on a started worker and stops it whatever happens. */
  async function withWorker(worker: WorkerAsr, use: (worker: WorkerAsr) => Promise<void>): Promise<void> {
    await worker.start()
    try {
      await use(worker)
    } finally {
      await worker.stop()
    }
  }

  it('sends an utterance as the samples of its WAVE file in chunks numbered from 0, then transcribe with its rate, and times the wait to the end', async () => {
    await withWorker(fakeRecognizer(true, 'optional'), async (worker) => {
      const pcm = utterance(16_384)
      const wav = encodeWav16(pcm)
      const { text, seconds } = await worker.transcribe(pcm, 'ja-JP')
      expect(text).toBe(`20000 samples at 8000 Hz, first ${wav.readInt16LE(44)}, last ${wav.readInt16LE(wav.length - 2)}`)
      // The fake reports progress at once and ends the request 0.1 s later.
      expect(seconds).toBeGreaterThanOrEqual(0.09)
    })
  })

  it('sends the language without its region, which a model refuses when it does not list it', async () => {
    await withWorker(fakeRecognizer(false, 'none'), async (worker) => {
      await expect(worker.transcribe(utterance(0), 'en-US')).rejects.toThrow('out_of_range (language): no en')
      expect((await worker.transcribe(utterance(0), 'ja-JP')).text).toMatch(/^20000 samples/)
    })
  })

  it('refuses a model file whose language steers it where the catalog says it cannot be told the language, and the reverse', async () => {
    for (const worker of [fakeRecognizer(true, 'none'), fakeRecognizer(false, 'optional')]) {
      try {
        await expect(worker.start()).rejects.toThrow(/correct languageHint/)
      } finally {
        await worker.stop()
      }
    }
  })

  it('keeps the text of a recognition that stopped at the most tokens the model writes', async () => {
    await withWorker(fakeRecognizer(true, 'optional'), async (worker) => {
      expect((await worker.transcribe(utterance(4), 'ja-JP')).text).toMatch(/^20000 samples/)
    })
  })

  it('takes a partial the bench did not ask for as the worker\'s defect, which fails every request after it', async () => {
    await withWorker(fakeRecognizer(true, 'optional'), async (worker) => {
      await expect(worker.transcribe(utterance(1), 'ja-JP')).rejects.toThrow(/sent partial for recognition request/)
      await expect(worker.transcribe(utterance(0), 'ja-JP')).rejects.toThrow(/sent partial for recognition request/)
    })
  })

  it('takes an end without a text, or with a stop a recognition does not have, as the worker\'s defect', async () => {
    await withWorker(fakeRecognizer(true, 'optional'), async (worker) => {
      await expect(worker.transcribe(utterance(2), 'ja-JP')).rejects.toThrow(/without a text/)
    })
    await withWorker(fakeRecognizer(true, 'optional'), async (worker) => {
      await expect(worker.transcribe(utterance(3), 'ja-JP')).rejects.toThrow(/stop "max_seconds"/)
    })
  })
})
