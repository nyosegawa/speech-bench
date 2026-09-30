import { describe, expect, it } from 'vitest'
import { loadPrompts, parsePrompts } from '../src/datasets/prompts.ts'

describe('prompts', () => {
  it('reads the Japanese prompts that ship with the bench', () => {
    const prompts = loadPrompts('record', 'ja-JP')
    expect(new Set(prompts.map((prompt) => prompt.id)).size).toBe(prompts.length)
  })

  it('refuses prompts written for another locale', () => {
    expect(() => parsePrompts(JSON.stringify({ locale: 'en-US', prompts: [] }), 'ja-JP')).toThrow(/en-US/)
  })

  it('refuses an id used twice, since it names the recording file', () => {
    const prompts = [{ id: 'a', kind: 'short', text: 'はい' }, { id: 'a', kind: 'short', text: 'いいえ' }]
    expect(() => parsePrompts(JSON.stringify({ locale: 'ja-JP', prompts }), 'ja-JP')).toThrow(/twice/)
  })
})
