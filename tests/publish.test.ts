import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { platformKey } from '../src/core/platform.ts'
import { countAcceptedErrors } from '../src/measure/accepted.ts'
import { FORM_IN_USE } from '../src/measure/kanji-forms.ts'
import { countErrors } from '../src/measure/scoring.ts'
import { readSpellingRecords, sentenceKey, spellingsFile } from '../src/spellings/files.ts'
import { parseAnnotated } from '../src/spellings/notation.ts'
import { publishedRows, type PublishedRow } from '../src/spellings/publish.ts'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})

const made = { by: 'codex gpt-6.1-sol medium', skill: 'abc1234', at: '2026-10-02' }

describe('publishedRows', () => {
  it('gives each clip the annotation of its sentence, in the order of the clips', () => {
    const rows = publishedRows(
      [{ clip: 'b.mp3', sentence: '明日は九時です。' }, { clip: 'a.mp3', sentence: 'はい' }],
      [{ line: 'はい', note: 'nothing to accept', ...made }, { line: '明日《あした》は［九《く》時《じ》／9時］です。', ...made }]
    )
    expect(rows.map((row) => [row.clip, row.sentence, row.note])).toEqual([['b.mp3', '明日は九時です。', null], ['a.mp3', 'はい', 'nothing to accept']])
    expect(rows[0]!.sentence_sha256).toBe(sentenceKey('明日は九時です。'))
    expect(rows[0]!.segments.map((segment) => segment.pieces.map((piece) => piece.text).join('')).join('')).toBe('明日は九時です。')
    expect(rows[0]!.segments.find((segment) => segment.bracketed)?.spellings).toEqual(['9時'])
  })

  it('stops when the sentence of a clip is not annotated', () => {
    expect(() => publishedRows([{ clip: 'a.mp3', sentence: 'はい' }, { clip: 'b.mp3', sentence: 'いいえ' }], [{ line: 'はい', ...made }])).toThrow(/b\.mp3/)
  })
})

/** A generator of the same numbers on every run, so that the transcriptions made from it are the same. */
function numbers(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

const katakana = (text: string): string => text.replace(/[ぁ-ゖ]/gu, (kana) => String.fromCodePoint(kana.codePointAt(0)! + 0x60))
const TRADITIONAL = new Map([...FORM_IN_USE].map(([traditional, inUse]) => [inUse, traditional]))

/**
 * Transcriptions of an annotated sentence: as written in other forms, read in kana in each of its readings, in each
 * of its other spellings and left out where it may be, and a few of these with edits.
 */
function transcriptionsOf(row: PublishedRow, random: () => number): string[] {
  const pieces = row.segments.flatMap((segment) => segment.pieces)
  const read = Array.from({ length: Math.max(1, ...pieces.map((piece) => piece.readings.length)) }, (_, which) =>
    pieces.map((piece) => {
      const reading = piece.readings[Math.min(which, piece.readings.length - 1)]
      return reading === undefined ? piece.text : random() < 0.5 ? reading : katakana(reading)
    }).join(''))
  const ways = (segment: PublishedRow['segments'][number]): string[] => [...segment.spellings, ...(segment.optional ? [''] : [])]
  const spelled = Array.from({ length: Math.max(1, ...row.segments.map((segment) => ways(segment).length)) }, (_, which) =>
    row.segments.map((segment) => ways(segment)[Math.min(which, ways(segment).length - 1)] ?? segment.pieces.map((piece) => piece.text).join('')).join(''))
  const unfolded = [...row.sentence].map((character) => TRADITIONAL.get(character) ?? (/[0-9A-Za-z]/.test(character) ? String.fromCodePoint(character.codePointAt(0)! + 0xfee0) : character)).join('')
  const edited = (text: string): string => {
    const characters = [...text]
    for (let edit = 0; edit < 3; edit++) {
      const at = Math.floor(random() * (characters.length + 1))
      const other = [...row.sentence][Math.floor(random() * [...row.sentence].length)]!
      const kind = random()
      if (kind < 0.33) characters.splice(at, 1)
      else if (kind < 0.66) characters.splice(at, 0, other)
      else characters.splice(at, 1, other)
    }
    return characters.join('')
  }
  return [unfolded, ...read, ...spelled, edited(read[0]!), edited(spelled[0]!)]
}

describe('the scorer published with the annotations', () => {
  it('counts the errors the bench counts, as written and with accepted spellings', () => {
    const records = [
      ...readSpellingRecords(spellingsFile('fleurs-ja-JP')).filter((_, index) => index % 8 === 0),
      { line: '［えーと／えっと／］、一日《ついたち／いちにち》は休《やす》みです。', ...made },
      { line: '｜1《いち》［から／〜］｜3《さん》まで', ...made }
    ]
    const rows = publishedRows(records.map((record, index) => ({ clip: `${index}.mp3`, sentence: parseAnnotated(record.line).reference })), records)
    const random = numbers(31)
    const transcriptions = rows.flatMap((row) => transcriptionsOf(row, random).map((text) => ({ clip: row.clip, text })))
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'published-'))
    folders.push(folder)
    fs.writeFileSync(path.join(folder, 'test.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
    fs.writeFileSync(path.join(folder, 'transcriptions.jsonl'), transcriptions.map((entry) => JSON.stringify(entry)).join('\n') + '\n')

    const scorer = path.join(import.meta.dirname, '..', 'huggingface', 'common-voice-ja-accepted-spellings', 'score.py')
    const python = platformKey() === 'win32-x64' ? 'python' : 'python3'
    const printed = execFileSync(python, [scorer, path.join(folder, 'test.jsonl'), path.join(folder, 'transcriptions.jsonl'), '--each'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)
    printed.pop()
    const byClip = new Map(rows.map((row) => [row.clip, row]))
    const bench = transcriptions.map(({ clip, text }) => {
      const row = byClip.get(clip)!
      return { clip, errors: countErrors(row.sentence, text, 'ja-JP').errors, accepted_errors: countAcceptedErrors(row.sentence, parseAnnotated(row.annotation).segments, text).errors }
    })
    const scored = printed.map((line) => JSON.parse(line) as { clip: string; errors: number; accepted_errors: number })
    expect(scored.map(({ clip, errors, accepted_errors }) => ({ clip, errors, accepted_errors }))).toEqual(bench)
    expect(bench.some((entry) => entry.accepted_errors < entry.errors)).toBe(true)
  }, 60_000)
})
