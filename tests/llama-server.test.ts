import { describe, expect, it } from 'vitest'
import { stripLanguagePrefix } from '../src/engines/llama-server.ts'

describe('stripLanguagePrefix', () => {
  it('removes the language Qwen3-ASR names before its transcription', () => {
    expect(stripLanguagePrefix('language Japanese<asr_text>こんにちは。')).toBe('こんにちは。')
  })

  it('keeps an answer that starts with the transcription', () => {
    expect(stripLanguagePrefix('language models are useful')).toBe('language models are useful')
  })
})
