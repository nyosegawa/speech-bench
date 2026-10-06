import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ttsModel, ttsVoiceFor } from '../src/catalog/models.ts'
import { audioCppConfig } from '../src/engines/audiocpp.ts'
import type { Synthesis } from '../src/engines/tts-engine.ts'
import { decodeChunk, parseWorkerLine, speechWorkerArgs } from '../src/engines/worker.ts'
import { WorkerTts, type WorkerRequests } from '../src/engines/worker-tts.ts'

describe('the worker protocol', () => {
  it('reads a JSON object per line and refuses any other line', () => {
    expect(parseWorkerLine('{"type":"end","id":"a","samples":0}')).toEqual({ type: 'end', id: 'a', samples: 0 })
    expect(() => parseWorkerLine('ggml_metal_init: loaded kernel')).toThrow(/not JSON/)
    expect(() => parseWorkerLine('[1]')).toThrow(/not a JSON object/)
  })

  it('decodes 16-bit little-endian samples', () => {
    const bytes = Buffer.alloc(4)
    bytes.writeInt16LE(16384, 0)
    bytes.writeInt16LE(-32768, 2)
    expect([...decodeChunk(bytes.toString('base64'))]).toEqual([0.5, -1])
  })
})

describe('WorkerTts', () => {
  let data: string
  beforeEach(() => {
    data = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-test-'))
    process.env.SPEECH_BENCH_DATA = data
  })
  afterEach(() => {
    delete process.env.SPEECH_BENCH_DATA
    fs.rmSync(data, { recursive: true, force: true })
  })

  const fakeWorker = (requests: Partial<WorkerRequests> = {}, protocol = '2'): WorkerTts => new WorkerTts(
    {
      name: 'fake',
      executable: process.execPath,
      args: [path.join(import.meta.dirname, 'fixtures', 'fake-worker.mjs')],
      env: { FAKE_WORKER_RATE: '24000', FAKE_WORKER_PROTOCOL: protocol }
    },
    { voice: 'reference', seed: null, options: {}, ...requests }
  )
  const values = (synthesis: Synthesis): number[] => [...synthesis.pcm.samples].map((value) => Math.round(value * 32768))

  /** Runs `use` on a started worker and stops it whatever happens. */
  async function withWorker(worker: WorkerTts, use: (worker: WorkerTts) => Promise<void>): Promise<void> {
    await worker.start()
    try {
      await use(worker)
    } finally {
      await worker.stop()
    }
  }

  it('starts the worker with the variables its command sets, joins the chunks of a sentence and times its first audio from the first chunk', async () => {
    await withWorker(fakeWorker(), async (worker) => {
      const synthesis = await worker.synthesize('はい。', 'ja-JP', null)
      expect(synthesis.pcm.sampleRate).toBe(24_000)
      expect(values(synthesis)).toEqual([3, 'reference'.length, -1, -1])
      // The fake reports progress at once and sends its first chunk 0.1 s later.
      expect(synthesis.firstAudioSeconds).toBeGreaterThanOrEqual(0.09)
    })
  })

  it('sends the first request the run\'s seed and each later one the next, with the options of the run', async () => {
    await withWorker(fakeWorker({ seed: 3, options: { steps: 16 } }), async (worker) => {
      expect(values(await worker.synthesize('はい。', 'ja-JP', null)).slice(2)).toEqual([3, 16])
      expect(values(await worker.synthesize('はい。', 'ja-JP', null)).slice(2)).toEqual([4, 16])
    })
  })

  it('fails the sentence the worker reports an error for, with its code, option and message', async () => {
    await withWorker(fakeWorker(), async (worker) => {
      await expect(worker.synthesize('Hello.', 'en-US', null)).rejects.toThrow('out_of_range (language): no en-US')
    })
  })

  it('refuses a worker that speaks another protocol', async () => {
    const worker = fakeWorker({}, '1')
    try {
      await expect(worker.start()).rejects.toThrow(/protocol 1/)
    } finally {
      await worker.stop()
    }
  })

  it('fails a sentence the worker cancelled though the bench did not cancel it', async () => {
    await withWorker(fakeWorker(), async (worker) => {
      await expect(worker.synthesize('cancelled', 'ja-JP', null)).rejects.toThrow(/did not cancel/)
    })
  })

  it('takes an answer without the id of a request as the worker\'s defect, which fails every request after it', async () => {
    await withWorker(fakeWorker(), async (worker) => {
      await expect(worker.synthesize('anonymous', 'ja-JP', null)).rejects.toThrow(/a request needs an id/)
      await expect(worker.synthesize('はい。', 'ja-JP', null)).rejects.toThrow(/a request needs an id/)
    })
  })

  it('takes a second terminal message for one request as the worker\'s defect, which fails every request after it', async () => {
    await withWorker(fakeWorker(), async (worker) => {
      expect(values(await worker.synthesize('twice', 'ja-JP', null))[0]).toBe(5)
      await expect(worker.synthesize('はい。', 'ja-JP', null)).rejects.toThrow(/has had its answer/)
    })
  })
})

describe('speechWorkerArgs', () => {
  it('starts speech worker on the model and the device, without its own warm-up, for a model of built-in voices', () => {
    expect(speechWorkerArgs('/m/qwen3-tts.gguf', 'MTL0', null)).toEqual(['worker', '/m/qwen3-tts.gguf', '--device', 'MTL0', '--no-warmup'])
  })

  it('adds the reference voice that every request names', () => {
    expect(speechWorkerArgs('/m/irodori-tts.gguf', 'Vulkan0', '/v/voice.gguf').slice(5)).toEqual(['--add-voice', 'reference=/v/voice.gguf'])
  })
})

describe('audioCppConfig', () => {
  it('loads the model as its family, offline, with the options every sentence is sent with', () => {
    const model = ttsModel('irodori-tts-v4-small-q8_0-8steps')
    if (model.runtime !== 'audio.cpp') throw new Error('expected an audio.cpp model')
    const config = audioCppConfig(model, '/models/irodori.gguf', 'metal', {}, null)
    expect(config).toMatchObject({ backend: 'metal', models: [{ id: model.id, family: 'irodori_tts', path: '/models/irodori.gguf', task: 'tts', mode: 'offline' }] })
    expect((config.models as Array<{ default_request_options: unknown }>)[0]!.default_request_options).toEqual(model.options)
  })

  it('runs the codec of Irodori-TTS on the CPU on Metal, whose codec doubles the voice, and not on Vulkan', () => {
    const model = ttsModel('irodori-tts-v4-small-q8_0-16steps')
    if (model.runtime !== 'audio.cpp') throw new Error('expected an audio.cpp model')
    const sessionOf = (backend: 'metal' | 'vulkan') => (audioCppConfig(model, '/m.gguf', backend, {}, null).models as Array<{ session_options: unknown }>)[0]!.session_options
    expect(sessionOf('metal')).toEqual({ 'irodori_tts.codec_backend': 'cpu' })
    expect(sessionOf('vulkan')).toEqual({})
  })

  it('gives every sentence the reference voice as the default voice preset, with no-reference generation off', () => {
    const model = ttsModel('irodori-tts-v4-small-q8_0-16steps')
    if (model.runtime !== 'audio.cpp') throw new Error('expected an audio.cpp model')
    const [entry] = audioCppConfig(model, '/m.gguf', 'vulkan', {}, '/data/references/voice.wav').models as Array<{ default_voice_preset: unknown; default_request_options: { no_ref: boolean } }>
    expect(entry!.default_voice_preset).toEqual({ voice_ref: '/data/references/voice.wav' })
    expect(entry!.default_request_options.no_ref).toBe(false)
  })

  it('sends every sentence with the seed and the voice description of the run, beside the options of the model', () => {
    const model = ttsModel('irodori-tts-v4-small-q8_0-8steps')
    if (model.runtime !== 'audio.cpp') throw new Error('expected an audio.cpp model')
    const config = audioCppConfig(model, '/models/irodori.gguf', 'metal', { seed: 3, instruction: '若い女性の声。' }, null)
    expect((config.models as Array<{ default_request_options: unknown }>)[0]!.default_request_options).toEqual({ ...model.options, seed: 3, instruction: '若い女性の声。' })
  })
})

describe('ttsVoiceFor', () => {
  const withVoices = { ...ttsModel('qwen3-tts-0.6b'), voices: [{ id: 'hana', native: 'ja' }, { id: 'jun', native: 'ko' }, { id: 'tom', native: 'en' }] }
  const withoutVoices = { ...withVoices, voices: [] }

  it('takes the voice native to the language when none is named', () => {
    expect(ttsVoiceFor(withVoices, 'ja-JP', undefined)).toBe('hana')
    expect(ttsVoiceFor(withVoices, 'ko-KR', undefined)).toBe('jun')
  })

  it('needs a voice named where no built-in voice is native to the language', () => {
    expect(() => ttsVoiceFor(withVoices, 'fr-FR', undefined)).toThrow(/--voice/)
    expect(ttsVoiceFor(withVoices, 'fr-FR', 'tom')).toBe('tom')
  })

  it('refuses a voice the model does not have, and any voice for a model without voices', () => {
    expect(() => ttsVoiceFor(withVoices, 'ja-JP', 'nobody')).toThrow()
    expect(() => ttsVoiceFor(withoutVoices, 'ja-JP', 'hana')).toThrow()
    expect(ttsVoiceFor(withoutVoices, 'ja-JP', undefined)).toBeNull()
  })
})
