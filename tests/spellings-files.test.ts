import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readSpellings, sentenceKey } from '../src/spellings/files.ts'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})

const made = { by: 'codex gpt-6.1-sol medium', skill: 'abc1234', at: '2026-10-02' }
const folderWith = (files: Record<string, unknown[]>): string => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'spellings-'))
  folders.push(folder)
  for (const [name, records] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), records.map((record) => JSON.stringify(record)).join('\n') + '\n')
  return folder
}

describe('readSpellings', () => {
  it('finds the annotation of a sentence by its reference, from the files of the locale only', () => {
    const folder = folderWith({
      'fleurs-ja-JP.jsonl': [{ line: '明日《あした》は［九《く》時《じ》／9時］です。', ...made }],
      'record-ja-JP.jsonl': [{ line: 'はい', note: 'nothing to accept', ...made }],
      'fleurs-ko-KR.jsonl': [{ line: '안녕하세요', ...made }]
    })
    const spellings = readSpellings('ja-JP', folder)
    expect(spellings.size).toBe(2)
    expect(spellings.get(sentenceKey('明日は九時です。'))?.segments.some((segment) => segment.spellings.includes('9時'))).toBe(true)
    expect(spellings.get(sentenceKey('はい'))?.record.note).toBe('nothing to accept')
  })

  it('stops at a sentence annotated twice, even in two files', () => {
    const folder = folderWith({ 'a-ja-JP.jsonl': [{ line: 'はい', ...made }], 'b-ja-JP.jsonl': [{ line: 'はい', ...made }] })
    expect(() => readSpellings('ja-JP', folder)).toThrow(/b-ja-JP\.jsonl/)
  })

  it('stops at a line that does not read or misses who made it', () => {
    expect(() => readSpellings('ja-JP', folderWith({ 'a-ja-JP.jsonl': [{ line: '明日は', ...made }] }))).toThrow()
    expect(() => readSpellings('ja-JP', folderWith({ 'a-ja-JP.jsonl': [{ line: 'はい', skill: 'abc', at: '2026-10-02' }] }))).toThrow()
    expect(() => readSpellings('ja-JP', folderWith({ 'a-ja-JP.jsonl': [{ line: 'はい', ...made, at: 'yesterday' }] }))).toThrow()
  })
})
