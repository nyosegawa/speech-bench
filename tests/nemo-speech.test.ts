import { describe, expect, it } from 'vitest'
import { nemoSpeechDevice, salmChatRequest, salmTranscript, withoutNemoSpeechSettings } from '../src/engines/nemo-speech.ts'

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

describe('a chat completion of NeMo-Speech.cpp\'s speech-LLM', () => {
  it('sends one user message of the instruction and the WAVE file in base64, decoded greedily, without a language', () => {
    const wav = Buffer.from('RIFF....WAVE')
    expect(salmChatRequest('salm', 'Audio transcription.', wav)).toEqual({
      model: 'salm',
      temperature: 0,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Audio transcription.' }, { type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } }] }]
    })
  })

  it('reads the transcript of the one choice, trimmed, an empty one included', () => {
    const answer = (content: string, finish: unknown = 'stop'): string => JSON.stringify({ object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish }] })
    expect(salmTranscript(answer(' 今日は晴れです。 '))).toBe('今日は晴れです。')
    expect(salmTranscript(answer(''))).toBe('')
  })

  it('refuses an answer that is not one choice finished with stop, rather than scoring a part of one', () => {
    const choice = { index: 0, message: { role: 'assistant', content: 'text' }, finish_reason: 'stop' }
    expect(() => salmTranscript(JSON.stringify({ choices: [choice, choice] }))).toThrow(/2 choices/)
    expect(() => salmTranscript(JSON.stringify({ choices: [{ ...choice, finish_reason: null }] }))).toThrow(/not stop/)
    expect(() => salmTranscript(JSON.stringify({ choices: [{ ...choice, message: { role: 'assistant' } }] }))).toThrow(/without a transcript/)
  })
})
