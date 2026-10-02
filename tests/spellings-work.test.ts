import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addChunk, readDraft, type Item } from '../src/spellings/draft.ts'
import { readSpellingRecords, readSpellings, sentenceKey } from '../src/spellings/files.ts'
import { mergeWork, type WorkRecord } from '../src/spellings/work.ts'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})
const temporary = (): string => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'spellings-work-'))
  folders.push(folder)
  return folder
}
const itemsOf = (...references: string[]): Item[] => references.map((reference) => ({ sentence: sentenceKey(reference), reference }))

describe('addChunk', () => {
  const items = itemsOf('明日は晴れ', 'はい', '九時です')

  it('writes nothing while any line of the chunk is wrong', () => {
    const draft = path.join(temporary(), 'spellings.jsonl')
    const result = addChunk(items, draft, '0\t明日《あした》は晴《は》れ\n1\tはい\n2\t九時です\n')
    expect(result.errors).toHaveLength(2)
    expect(fs.existsSync(draft)).toBe(false)
  })

  it('refuses a line that does not give back its sentence exactly', () => {
    const draft = path.join(temporary(), 'spellings.jsonl')
    expect(addChunk(items, draft, '0\t明日《あした》は晴《は》れた\n').errors).toHaveLength(1)
    expect(addChunk(itemsOf('A／B'), draft, '0\t｜A《エー》／｜B《ビー》\n').errors).toHaveLength(1)
  })

  it('keeps the draft in the order of the items, notes included, and names a sentence skipped', () => {
    const draft = path.join(temporary(), 'spellings.jsonl')
    expect(addChunk(items, draft, '2\t［九《く》時《じ》／9時］です\tnine o\'clock\n').skipped).toEqual([0, 1])
    const result = addChunk(items, draft, '0\t明日《あした》は晴《は》れ\n1\tはい\n')
    expect(result).toMatchObject({ errors: [], added: [0, 1], skipped: [], annotated: 3 })
    expect([...readDraft(draft).values()].map((drafted) => drafted.line)).toEqual(['明日《あした》は晴《は》れ', 'はい', '［九《く》時《じ》／9時］です'])
    expect(readDraft(draft).get(items[2]!.sentence)?.note).toBe('nine o\'clock')
  })
})

describe('mergeWork', () => {
  const work: WorkRecord = { source: 'fleurs-ja-JP', skill: 'abc1234', by: 'codex-cli 0.160.0 gpt-6.1-sol medium', createdAt: '2026-10-03T00:00:00.000Z' }
  const workDirectory = (items: Item[], lines: Record<number, string>): string => {
    const directory = temporary()
    fs.writeFileSync(path.join(directory, 'work.json'), JSON.stringify(work))
    fs.writeFileSync(path.join(directory, 'items.jsonl'), items.map((item) => JSON.stringify(item)).join('\n') + '\n')
    fs.writeFileSync(path.join(directory, 'spellings.jsonl'), Object.entries(lines).map(([index, line]) => JSON.stringify({ sentence: items[Number(index)]!.sentence, line })).join('\n') + '\n')
    return directory
  }
  const sentences = ['はい', '明日は晴れ', '九時です']

  it('puts a whole draft into the source\'s file with who made it, in the order of the source', () => {
    const folder = temporary()
    const items = itemsOf('九時です', 'はい')
    expect(mergeWork(workDirectory(items, { 0: '［九《く》時《じ》／9時］です', 1: 'はい' }), sentences, '2026-10-03', folder)).toEqual({ merged: 2, replaced: 0 })
    mergeWork(workDirectory(itemsOf('明日は晴れ'), { 0: '明日《あした》は晴《は》れ' }), sentences, '2026-10-04', folder)
    const records = readSpellingRecords(path.join(folder, 'fleurs-ja-JP.jsonl'))
    expect(records.map((record) => [record.line, record.at])).toEqual([['はい', '2026-10-03'], ['明日《あした》は晴《は》れ', '2026-10-04'], ['［九《く》時《じ》／9時］です', '2026-10-03']])
    expect(records[0]).toMatchObject({ by: work.by, skill: work.skill })
    expect(readSpellings('ja-JP', folder).size).toBe(3)
  })

  it('takes the new line for a sentence annotated before', () => {
    const folder = temporary()
    mergeWork(workDirectory(itemsOf('九時です'), { 0: '九《く》時《じ》です' }), sentences, '2026-10-03', folder)
    expect(mergeWork(workDirectory(itemsOf('九時です'), { 0: '［九《く》時《じ》／9時］です' }), sentences, '2026-10-04', folder)).toEqual({ merged: 1, replaced: 1 })
    expect(readSpellingRecords(path.join(folder, 'fleurs-ja-JP.jsonl')).map((record) => record.line)).toEqual(['［九《く》時《じ》／9時］です'])
  })

  it('refuses a draft with a sentence missing, and leaves the file as it was', () => {
    const folder = temporary()
    expect(() => mergeWork(workDirectory(itemsOf('九時です', 'はい'), { 1: 'はい' }), sentences, '2026-10-03', folder)).toThrow()
    expect(fs.existsSync(path.join(folder, 'fleurs-ja-JP.jsonl'))).toBe(false)
  })
})
