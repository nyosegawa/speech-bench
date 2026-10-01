import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatRecipes, loadRecipes, parseRecipes, recordChoice } from '../src/make/recipes.ts'

const recipes = {
  locale: 'ja-JP',
  voices: [
    { id: 'calm', description: '落ち着いた声', lines: [{ id: 'l1', kind: 'statement', text: 'はい。' }] },
    { id: 'bright', description: '明るい声', lines: [{ id: 'l1', kind: 'statement', text: 'やった!' }], chosen: { reference: 'voice-bright', candidate: 'bright-candidate-2', sha256: 'a'.repeat(64) } }
  ]
}

describe('voice recipes', () => {
  let folder: string
  beforeEach(() => { folder = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-test-')) })
  afterEach(() => fs.rmSync(folder, { recursive: true, force: true }))

  it('records a choice in one voice and leaves the others as they were', () => {
    const file = path.join(folder, 'voices-ja-JP.json')
    fs.writeFileSync(file, formatRecipes('ja-JP', parseRecipes(JSON.stringify(recipes), 'ja-JP')))
    recordChoice('ja-JP', 'calm', { reference: 'voice-calm', candidate: 'calm-candidate-1', sha256: 'b'.repeat(64) }, file)
    const [calm, bright] = loadRecipes('ja-JP', file)
    expect(calm!.chosen).toEqual({ reference: 'voice-calm', candidate: 'calm-candidate-1', sha256: 'b'.repeat(64) })
    expect(bright).toEqual(parseRecipes(JSON.stringify(recipes), 'ja-JP')[1])
  })

  it('refuses a voice named twice and a line named twice, since names become file names', () => {
    expect(() => parseRecipes(JSON.stringify({ ...recipes, voices: [recipes.voices[0], recipes.voices[0]] }), 'ja-JP')).toThrow(/twice/)
    const twice = { ...recipes.voices[0], lines: [recipes.voices[0]!.lines[0], recipes.voices[0]!.lines[0]] }
    expect(() => parseRecipes(JSON.stringify({ ...recipes, voices: [twice] }), 'ja-JP')).toThrow(/used once/)
  })
})
