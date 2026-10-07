import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatReport, summarize as summarizeFile, type AsrSummary, type Summary, type TtsSummary } from '../src/measure/report.ts'
import { parseResultFile } from '../src/measure/result-file/file.ts'
import { sentenceKey, type Spellings } from '../src/spellings/files.ts'
import { parseAnnotated } from '../src/spellings/notation.ts'
import { asrRun as asrRunOf, ttsRun as ttsRunOf } from './run-records.ts'

const asrRun = asrRunOf({ set: { name: 'set', locale: 'ja-JP', size: 3 }, audio: { edges: 'energy-vad', hangoverMs: 600 } })
const utterance = (reference: string, text: string, seconds: number, audioSeconds: number) =>
  JSON.stringify({ type: 'utterance', id: `${reference}-${text}`, reference, text, seconds, audioSeconds })

const asr = (summary: Summary): AsrSummary => {
  if (summary.run.task !== 'asr') throw new Error('expected a speech recognition summary')
  return summary as AsrSummary
}
const tts = (summary: Summary): TtsSummary => {
  if (summary.run.task !== 'tts') throw new Error('expected a speech synthesis summary')
  return summary as TtsSummary
}
const noSpellings = (): Spellings => new Map()
const fixture = (name: string): string[] => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'result-file', name), 'utf8').split('\n')
const summarize = (lines: readonly string[], spellingsOf: (locale: string) => Spellings): Summary => summarizeFile(parseResultFile(lines.join('\n'), 'run.jsonl'), spellingsOf)

describe('summarize a speech recognition run', () => {
  it('divides the errors of the whole set by its reference length', () => {
    // Per-utterance rates would average (1/1 + 0/9) / 2 = 50%; the corpus rate is 1/10.
    const summary = asr(summarize([JSON.stringify(asrRun), utterance('あ', 'い', 0.2, 2), utterance('かきくけこさしすせ', 'かきくけこさしすせ', 0.4, 4)], noSpellings))
    expect(summary.errorRate).toBeCloseTo(0.1)
    expect(summary.realTimeFactor).toBeCloseTo(0.1)
  })

  it('counts the utterances dropped by the VAD apart, leaving them out of the error rate and the timings', () => {
    const dropped = JSON.stringify({ type: 'utterance', id: 'short-hai', reference: 'はい', droppedBy: 'energy-vad' })
    const summary = asr(summarize([JSON.stringify(asrRun), dropped, utterance('かきくけこ', 'かきくけ', 0.4, 4)], noSpellings))
    expect(summary.utterances).toBe(2)
    expect(summary.dropped).toBe(1)
    expect(summary.errorRate).toBeCloseTo(1 / 5)
    expect(summary.empty).toBe(0)
    expect(summary.medianSeconds).toBeCloseTo(0.4)
    expect(summary.realTimeFactor).toBeCloseTo(0.1)
  })

  it('counts transcriptions that came back empty', () => {
    expect(asr(summarize([JSON.stringify(asrRun), utterance('あいう', '', 0.1, 1), utterance('あいう', 'あいう', 0.1, 1)], noSpellings)).empty).toBe(1)
  })

  it('names the commit of a local build that ran in place of a release, and reads a run of format 12 as the release\'s', () => {
    const local = asr(summarize(fixture('v13-asr.jsonl'), noSpellings))
    expect(formatReport([local])).toContain('| speech.cpp 0.7.1, local build 596b8d8c1f2a |')
    const released = asr(summarize(fixture('v12-asr.jsonl'), noSpellings))
    expect(released.run.runtime.localBuild).toBeNull()
    expect(formatReport([released])).toContain('| crispasr v0.8.38 |')
  })

  it('reads a run trimmed to the voice, with an utterance in which no voice was found', () => {
    const run = asr(summarize(fixture('v12-asr.jsonl'), noSpellings))
    expect(run.run.audio).toEqual({ edges: 'voice', detector: 'silero-vad-v4', marginSeconds: 0.2 })
    expect(run.dropped).toBe(1)
    expect(formatReport([run])).toContain('trimmed to the voice silero-vad-v4 finds, with 0.2 s around it')
  })
})

describe('the error rate with accepted spellings', () => {
  const made = { by: 'test', skill: 'test', at: '2026-10-02' }
  const spellingsOf = (...lines: string[]) => (): Spellings => new Map(lines.map((line) => {
    const { errors, ...annotated } = parseAnnotated(line)
    if (errors.length > 0) throw new Error(errors.join('; '))
    return [sentenceKey(annotated.reference), { ...annotated, record: { line, ...made } }]
  }))
  const lines = [JSON.stringify(asrRun), utterance('今日は', 'きょうは', 0.1, 1), utterance('はい', 'はい', 0.1, 1)]

  it('waits until every utterance heard is annotated, and says how many are', () => {
    const summary = asr(summarize(lines, spellingsOf('今日《きょう》は')))
    expect(summary.annotated).toBe(1)
    expect(summary.acceptedErrorRate).toBeNull()
  })

  it('counts the errors left once the readings and spellings are accepted, over the reference length as written', () => {
    const summary = asr(summarize(lines, spellingsOf('今日《きょう》は', 'はい')))
    expect(summary.errorRate).toBeCloseTo(3 / 5)
    expect(summary.annotated).toBe(2)
    expect(summary.acceptedErrorRate).toBe(0)
  })

  it('is not counted for a language scored by word', () => {
    const english = [JSON.stringify({ ...asrRun, set: { name: 'set', locale: 'en-US', size: 1 } }), utterance('hello there', 'hello there', 0.1, 1)]
    expect(asr(summarize(english, spellingsOf('はい'))).acceptedErrorRate).toBeNull()
  })
})

describe('summarize a speech synthesis run', () => {
  it('reads a speech synthesis run spoken like a reference voice at a scaled length', () => {
    const summary = tts(summarize(fixture('v12-tts.jsonl'), noSpellings))
    expect(summary.sentences).toBe(3)
    expect(summary.run.durationScale).toBe(0.5)
  })

  const ttsRun = ttsRunOf({ set: { name: 'speak', locale: 'ja-JP', size: 2 }, voice: 'ono_anna' })
  const sentence = (text: string, transcript: string, firstAudioSeconds: number, totalSeconds: number, audioSeconds: number) =>
    JSON.stringify({ type: 'sentence', id: text, kind: 'reply', text, audio: `${text}.wav`, audioSeconds, firstAudioSeconds, totalSeconds, transcript })

  it('adds up what was misheard, the time to the first audio and the pace of the speech', () => {
    const summary = tts(summarize([JSON.stringify(ttsRun), sentence('はい', 'はい', 0.05, 0.3, 0.5), sentence('こんにちは', 'こんばんは', 0.07, 0.5, 1.5)], noSpellings))
    expect(summary.errorRate).toBeCloseTo(2 / 7)
    expect(summary.medianFirstAudioSeconds).toBeCloseTo(0.05)
    expect(summary.realTimeFactor).toBeCloseTo(0.8 / 2)
    expect(summary.secondsPerCharacter).toBeCloseTo(2 / 7)
  })
})
