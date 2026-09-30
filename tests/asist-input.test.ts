import { describe, expect, it } from 'vitest'
import { loadItems, parseItems } from '../src/asist-input/items.ts'
import { percentile } from '../src/asist-input/report.ts'

describe('parseItems', () => {
  const file = (items: unknown[]): string => JSON.stringify({ locale: 'ja-JP', items })

  it('refuses an interrupt with nothing to say', () => {
    expect(() => parseItems(file([{ id: 'interrupt-matte', kind: 'interrupt', seconds: 5 }]), 'ja-JP')).toThrow(/needs text/)
  })

  it('refuses a noise without a note saying what to do', () => {
    expect(() => parseItems(file([{ id: 'noise-cough', kind: 'noise', seconds: 5 }]), 'ja-JP')).toThrow(/needs a note/)
  })

  it('refuses items for another locale', () => {
    expect(() => parseItems(JSON.stringify({ locale: 'en-US', items: [] }), 'ja-JP')).toThrow(/en-US/)
  })

  it('reads the items that ship with the bench, with an interrupt only after something said', () => {
    const items = loadItems('ja-JP')
    items.forEach((item, index) => {
      if (item.kind === 'interrupt') expect(items[index - 1]?.kind).toBe('say')
    })
  })
})

describe('percentile', () => {
  it('interpolates between ranks', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(percentile([0, 10], 0.95)).toBeCloseTo(9.5)
  })
})
