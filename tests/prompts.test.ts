import { describe, expect, it } from 'vitest'
import { parsePrompts } from '../src/datasets/prompts.ts'

describe('prompts', () => {
  it('refuses prompts written for another locale', () => {
    expect(() => parsePrompts(JSON.stringify({ locale: 'en-US', prompts: [] }), 'ja-JP')).toThrow(/en-US/)
  })

  it('refuses an id used twice, since it names the recording file', () => {
    const prompts = [{ id: 'a', kind: 'short', text: 'はい' }, { id: 'a', kind: 'short', text: 'いいえ' }]
    expect(() => parsePrompts(JSON.stringify({ locale: 'ja-JP', prompts }), 'ja-JP')).toThrow(/twice/)
  })
})
