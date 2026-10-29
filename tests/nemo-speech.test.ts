import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { asrModel } from '../src/catalog/models.ts'
import { NemoSpeechAsr, nemoSpeechDevice, salmChatRequest, salmTranscript, withoutNemoSpeechSettings } from '../src/engines/nemo-speech.ts'

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

describe('a NeMo-Speech.cpp server that is not ready as asked', () => {
  let folder: string | null = null
  let pid: number | null = null
  afterEach(() => {
    if (pid !== null) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Stopped already, as it should be.
      }
    }
    delete process.env.SPEECH_BENCH_DATA
    delete process.env.FAKE_NEMO_SPEECH_PID
    if (folder) fs.rmSync(folder, { recursive: true, force: true })
    folder = pid = null
  })

  // The server stands in as a script run through its shebang, which Windows does not run.
  it.skipIf(process.platform === 'win32')('is stopped when it is ready on another device, so that it does not keep the model loaded', async () => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-nemo-speech-'))
    process.env.SPEECH_BENCH_DATA = folder
    process.env.FAKE_NEMO_SPEECH_PID = path.join(folder, 'pid')
    const server = path.join(folder, 'nemo-speech')
    fs.writeFileSync(server, [
      `#!${process.execPath}`,
      "const fs = require('node:fs')",
      "const http = require('node:http')",
      'fs.writeFileSync(process.env.FAKE_NEMO_SPEECH_PID, String(process.pid))',
      "const port = Number(process.argv[process.argv.indexOf('--port') + 1])",
      "http.createServer((request, response) => response.end(JSON.stringify({ device: 'cpu', capabilities: ['asr'] }))).listen(port, '127.0.0.1')",
      ''
    ].join('\n'), { mode: 0o755 })
    const engine = new NemoSpeechAsr(server, asrModel('parakeet-tdt-0.6b-v3-nemo-speech.cpp'), path.join(folder, 'model.gguf'), 'metal')
    await expect(engine.start()).rejects.toThrow(/not with speech recognition on metal/)
    pid = Number(fs.readFileSync(process.env.FAKE_NEMO_SPEECH_PID, 'utf8'))
    expect(() => process.kill(pid!, 0)).toThrow()
  })
})
