import { describe, expect, it } from 'vitest'
import { ttsModel, ttsVoiceFor } from '../src/catalog.ts'
import { audioCppConfig } from '../src/engines/audiocpp.ts'
import { decodeChunk, parseWorkerLine } from '../src/engines/qwen3-tts-worker.ts'

describe('the Qwen3-TTS worker protocol', () => {
  it('reads a message after the prefix and ignores other output', () => {
    expect(parseWorkerLine('ASIST_JSON:{"type":"ready","sampleRate":24000}')).toEqual({ type: 'ready', sampleRate: 24000 })
    expect(parseWorkerLine('ggml_metal_init: loaded kernel')).toBeNull()
  })

  it('decodes 16-bit little-endian samples', () => {
    const bytes = Buffer.alloc(4)
    bytes.writeInt16LE(16384, 0)
    bytes.writeInt16LE(-32768, 2)
    expect([...decodeChunk(bytes.toString('base64'))]).toEqual([0.5, -1])
  })
})

describe('audioCppConfig', () => {
  it('loads the model as its family, offline, with the options every sentence is sent with', () => {
    const model = ttsModel('irodori-tts-v4-small-8steps')
    if (model.runtime !== 'audio.cpp') throw new Error('expected an audio.cpp model')
    const config = audioCppConfig(model, '/models/irodori.gguf', 'metal', {}, null)
    expect(config).toMatchObject({ backend: 'metal', models: [{ id: model.id, family: 'irodori_tts', path: '/models/irodori.gguf', task: 'tts', mode: 'offline' }] })
    expect((config.models as Array<{ default_request_options: unknown }>)[0]!.default_request_options).toEqual({ language: 'ja', no_ref: true, num_inference_steps: 8 })
  })

  it('runs the codec of Irodori-TTS on the CPU on Metal, whose codec doubles the voice, and not on Vulkan', () => {
    const model = ttsModel('irodori-tts-v4-small-16steps')
    if (model.runtime !== 'audio.cpp') throw new Error('expected an audio.cpp model')
    const sessionOf = (backend: 'metal' | 'vulkan') => (audioCppConfig(model, '/m.gguf', backend, {}, null).models as Array<{ session_options: unknown }>)[0]!.session_options
    expect(sessionOf('metal')).toEqual({ 'irodori_tts.codec_backend': 'cpu' })
    expect(sessionOf('vulkan')).toEqual({})
  })

  it('gives every sentence the reference voice as the default voice preset, with no-reference generation off', () => {
    const model = ttsModel('irodori-tts-v4-small-16steps')
    if (model.runtime !== 'audio.cpp') throw new Error('expected an audio.cpp model')
    const [entry] = audioCppConfig(model, '/m.gguf', 'vulkan', {}, '/data/references/voice.wav').models as Array<{ default_voice_preset: unknown; default_request_options: { no_ref: boolean } }>
    expect(entry!.default_voice_preset).toEqual({ voice_ref: '/data/references/voice.wav' })
    expect(entry!.default_request_options.no_ref).toBe(false)
  })

  it('sends every sentence with the seed and the voice description of the run, beside the options of the model', () => {
    const model = ttsModel('irodori-tts-v4-small-8steps')
    if (model.runtime !== 'audio.cpp') throw new Error('expected an audio.cpp model')
    const config = audioCppConfig(model, '/models/irodori.gguf', 'metal', { seed: 3, instruction: '若い女性の声。' }, null)
    expect((config.models as Array<{ default_request_options: unknown }>)[0]!.default_request_options).toEqual({ language: 'ja', no_ref: true, num_inference_steps: 8, seed: 3, instruction: '若い女性の声。' })
  })
})

describe('ttsVoiceFor', () => {
  const qwen = ttsModel('qwen3-tts-0.6b')

  it('takes the voice native to the language when none is named', () => {
    expect(ttsVoiceFor(qwen, 'ja-JP', undefined)).toBe('ono_anna')
    expect(ttsVoiceFor(qwen, 'ko-KR', undefined)).toBe('sohee')
  })

  it('needs a voice named where no built-in voice is native to the language', () => {
    expect(() => ttsVoiceFor(qwen, 'fr-FR', undefined)).toThrow(/--voice/)
    expect(ttsVoiceFor(qwen, 'fr-FR', 'ryan')).toBe('ryan')
  })

  it('refuses a voice the model does not have, and any voice for a model without voices', () => {
    expect(() => ttsVoiceFor(qwen, 'ja-JP', 'nobody')).toThrow()
    expect(() => ttsVoiceFor(ttsModel('irodori-tts-v4-small'), 'ja-JP', 'ono_anna')).toThrow()
    expect(ttsVoiceFor(ttsModel('irodori-tts-v4-small'), 'ja-JP', undefined)).toBeNull()
  })
})
