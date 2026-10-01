import { describe, expect, it } from 'vitest'
import { ttsModel, ttsVoiceFor } from '../src/catalog.ts'
import { audioCppConfig } from '../src/engines/audiocpp.ts'
import { decodeChunk, parseWorkerLine } from '../src/engines/worker.ts'
import { speechWorkerArgs } from '../src/run-tts.ts'

describe('the worker protocol', () => {
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

describe('speechWorkerArgs', () => {
  it('starts speech.cpp\'s worker on the model, its codec and the device, with nothing else for a model of built-in voices', () => {
    expect(speechWorkerArgs(['/m/talker.gguf', '/m/codec.gguf'], 'MTL0', null, null, null)).toEqual(['/m/talker.gguf', '/m/codec.gguf', '--device', 'MTL0'])
  })

  it('gives the seed, the sampler\'s steps and the reference voice that every request names', () => {
    const args = speechWorkerArgs(['/m/rf.gguf', '/m/codec.gguf'], 'Vulkan0', 3, 16, '/v/voice.gguf')
    expect(args.slice(4)).toEqual(['--seed', '3', '--steps', '16', '--voice', 'reference=/v/voice.gguf'])
  })
})

describe('audioCppConfig', () => {
  it('loads the model as its family, offline, with the options every sentence is sent with', () => {
    const model = ttsModel('irodori-tts-v4-small-8steps')
    if (model.runtime !== 'audio.cpp') throw new Error('expected an audio.cpp model')
    const config = audioCppConfig(model, '/models/irodori.gguf', 'metal', {}, null)
    expect(config).toMatchObject({ backend: 'metal', models: [{ id: model.id, family: 'irodori_tts', path: '/models/irodori.gguf', task: 'tts', mode: 'offline' }] })
    expect((config.models as Array<{ default_request_options: unknown }>)[0]!.default_request_options).toEqual(model.options)
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
