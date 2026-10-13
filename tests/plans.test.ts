import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePlan } from '../src/measure/plan-file/file.ts'
import { checkPlan, combinationsOf, doneOf, roundOrder, schedule } from '../src/measure/plans.ts'

const sample = parsePlan(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'plan-file', 'v1.json'), 'utf8'), 'v1.json')

describe('the combinations of a plan', () => {
  it('runs a speech.cpp entry in every build and device, and another runtime once, as its pinned release', () => {
    const [recognition] = sample.entries
    const ofFirst = combinationsOf({ ...sample, entries: [recognition!] })
    expect(ofFirst.map(({ model, build }) => `${model} ${String(build)}`)).toEqual([
      'qwen3-asr-0.6b-speech.cpp v0.8.4',
      'qwen3-asr-0.6b-speech.cpp ci:18276543210',
      'qwen3-asr-0.6b null',
      'qwen3-asr-0.6b-official null'
    ])
  })

  it('runs a synthesis once for each seed, and tells every combination apart', () => {
    const combinations = combinationsOf(sample)
    // 4 recognitions, 2 builds by 2 devices, and 3 seeds of 2 builds and of the official implementation.
    expect(combinations).toHaveLength(4 + 4 + 9)
    expect(new Set(combinations.map((combination) => combination.key)).size).toBe(combinations.length)
  })

  it('refuses a device for a runtime the bench gives none, before anything runs', () => {
    const adapter = { ...sample, entries: [{ ...sample.entries[2]!, devices: ['CPU'] }] }
    expect(() => checkPlan(adapter)).toThrow(/gives no device/)
  })
})

describe('the order of a round', () => {
  const combinations = combinationsOf(sample)

  it('runs each combination once, in an order a resumed plan finds again', () => {
    const order = roundOrder(combinations, sample.campaign, 2)
    expect([...order].sort((a, b) => a.key.localeCompare(b.key))).toEqual([...combinations].sort((a, b) => a.key.localeCompare(b.key)))
    expect(roundOrder(combinations, sample.campaign, 2).map((combination) => combination.key)).toEqual(order.map((combination) => combination.key))
  })

  it('changes from round to round', () => {
    const orders = new Set([1, 2, 3].map((round) => roundOrder(combinations, sample.campaign, round).map((combination) => combination.key).join('\n')))
    expect(orders.size).toBe(3)
  })
})

describe('resuming a plan', () => {
  it('skips the rounds of combinations the campaign\'s runs were made for, and no other', () => {
    const [first] = roundOrder(combinationsOf(sample), sample.campaign, 1)
    const done = doneOf([{ plan: { combination: first!.key, round: 1 } }, { plan: null }])
    const steps = schedule(sample, done)
    expect(steps).toHaveLength(17 * 3)
    expect(steps.filter((step) => step.done)).toEqual([{ round: 1, combination: first, done: true }])
  })
})
