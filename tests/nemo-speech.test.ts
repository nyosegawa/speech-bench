import { describe, expect, it } from 'vitest'
import { nemoSpeechDevice, withoutNemoSpeechSettings } from '../src/engines/nemo-speech.ts'

describe('nemoSpeechDevice', () => {
  it('tells NeMo-Speech.cpp the GPU ggml names, counting Vulkan devices from 0', () => {
    expect(nemoSpeechDevice('MTL0')).toBe('metal')
    expect(nemoSpeechDevice('Vulkan0')).toBe('vulkan:0')
    expect(nemoSpeechDevice('Vulkan1')).toBe('vulkan:1')
  })

  it('refuses a device NeMo-Speech.cpp cannot be told, rather than leaving it to choose one', () => {
    expect(() => nemoSpeechDevice('CUDA0')).toThrow(/metal or vulkan:N/)
  })
})

describe('withoutNemoSpeechSettings', () => {
  it('leaves out every variable NeMo-Speech.cpp reads an engine setting from, whatever its case, and keeps the rest', () => {
    const env = { PATH: '/usr/bin', NEMO_SPEECH_ASR_POSTPROC_PNC_MODEL_PATH: 'pnc.gguf', nemo_speech_asr_vad_masker_mask_enable: 'true', SPEECH_BENCH_DATA: '/data' }
    expect(withoutNemoSpeechSettings(env)).toEqual({ PATH: '/usr/bin', SPEECH_BENCH_DATA: '/data' })
  })
})
