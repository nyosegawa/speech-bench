import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatReport, summarize, type AsrSummary, type Summary, type TtsSummary } from '../src/report.ts'

const asrRun = { type: 'run', format: 4, task: 'asr', set: { name: 'set', locale: 'ja-JP', size: 3 }, audio: { edges: 'asist', hangoverMs: 600 }, loadSeconds: 1, warmupSeconds: 1 }
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
const fixture = (name: string): string[] => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8').split('\n')

describe('summarize a speech recognition run', () => {
  it('divides the errors of the whole set by its reference length', () => {
    // Per-utterance rates would average (1/1 + 0/9) / 2 = 50%; the corpus rate is 1/10.
    const summary = asr(summarize([JSON.stringify(asrRun), utterance('あ', 'い', 0.2, 2), utterance('かきくけこさしすせ', 'かきくけこさしすせ', 0.4, 4)]))
    expect(summary.errorRate).toBeCloseTo(0.1)
    expect(summary.realTimeFactor).toBeCloseTo(0.1)
  })

  it('counts the utterances dropped by the VAD apart, leaving them out of the error rate and the timings', () => {
    const dropped = JSON.stringify({ type: 'utterance', id: 'short-hai', reference: 'はい', droppedBy: 'asist-vad' })
    const summary = asr(summarize([JSON.stringify(asrRun), dropped, utterance('かきくけこ', 'かきくけ', 0.4, 4)]))
    expect(summary.utterances).toBe(2)
    expect(summary.dropped).toBe(1)
    expect(summary.errorRate).toBeCloseTo(1 / 5)
    expect(summary.empty).toBe(0)
    expect(summary.medianSeconds).toBeCloseTo(0.4)
    expect(summary.realTimeFactor).toBeCloseTo(0.1)
  })

  it('counts transcriptions that came back empty', () => {
    expect(asr(summarize([JSON.stringify(asrRun), utterance('あいう', '', 0.1, 1), utterance('あいう', 'あいう', 0.1, 1)])).empty).toBe(1)
  })

  it('refuses a file without its run line, and a format it does not know', () => {
    expect(() => summarize([utterance('あ', 'あ', 0.1, 1)])).toThrow()
    expect(() => summarize([JSON.stringify({ ...asrRun, format: 999 }), utterance('あ', 'あ', 0.1, 1)])).toThrow(/format 999/)
  })

  it('reads format 1 as audio sent as recorded, and formats 1 and 2 as speech recognition', () => {
    const one = asr(summarize(fixture('result-format-1.jsonl')))
    expect(one.utterances).toBe(3)
    expect(one.run.audio).toEqual({ edges: 'as-recorded', trailingSilence: 0 })
    const two = asr(summarize(fixture('result-format-2.jsonl')))
    expect(two.run.audio).toEqual({ edges: 'asist', hangoverMs: 600 })
  })

  it('reads a speech recognition result file of format 3, counting its errors from its texts', () => {
    const three = asr(summarize(fixture('result-format-3-asr.jsonl')))
    expect(three.utterances).toBe(3)
    expect(three.run.audio).toEqual({ edges: 'asist', hangoverMs: 600 })
    expect(three.errorRate).toBeGreaterThanOrEqual(0)
  })

  it('reads a speech recognition result file of format 4 as one without dropped utterances', () => {
    const four = asr(summarize(fixture('result-format-4-asr.jsonl')))
    expect(four.utterances).toBe(3)
    expect(four.dropped).toBe(0)
  })

  it('reads a speech recognition result file of format 6', () => {
    expect(asr(summarize(fixture('result-format-6-asr.jsonl'))).dropped).toBe(1)
  })

  it('reads runs before format 8 as loaded with the runtime defaults, and says the options a run was loaded with', () => {
    expect(asr(summarize(fixture('result-format-6-asr.jsonl'))).run.runtime.options).toEqual({})
    expect(asr(summarize(fixture('result-format-8-asr.jsonl'))).run.runtime.options).toEqual({})
    expect(asr(summarize(fixture('result-format-9-asr.jsonl'))).run.runtime.options).toEqual({})
    expect(asr(summarize(fixture('result-format-10-asr.jsonl'))).run.runtime.options).toEqual({})
    const report = formatReport([summarize(fixture('result-format-8-tts.jsonl'))])
    expect(report).toContain('irodori_tts.codec_backend=cpu')
  })

  it('reads a speech recognition result file of format 5 with an utterance dropped by the VAD', () => {
    const five = asr(summarize(fixture('result-format-5-asr.jsonl')))
    expect(five.utterances).toBe(3)
    expect(five.dropped).toBe(1)
    expect(five.errorRate).toBeGreaterThan(0)
  })

  it('reads a run of format 11 trimmed to the voice, with an utterance in which no voice was found', () => {
    const eleven = asr(summarize(fixture('result-format-11-asr.jsonl')))
    expect(eleven.run.audio).toEqual({ edges: 'voice', detector: 'silero-vad-v4', marginSeconds: 0.2 })
    expect(eleven.dropped).toBe(1)
    expect(formatReport([eleven])).toContain('trimmed to the voice silero-vad-v4 finds, with 0.2 s around it')
  })
})

describe('summarize a speech synthesis run', () => {
  it('reads a speech synthesis run of format 5 as one without a seed, whose runtime chose one for each sentence', () => {
    expect(tts(summarize(fixture('result-format-5-tts.jsonl'))).run.seed).toBeNull()
  })

  it('reads speech synthesis result files of formats 3 to 9, those before 9 without a reference voice', () => {
    const three = tts(summarize(fixture('result-format-3-tts.jsonl')))
    expect(three.sentences).toBe(3)
    expect(three.run.voice).toBe('ono_anna')
    expect(tts(summarize(fixture('result-format-4-tts.jsonl'))).sentences).toBe(3)
    expect(tts(summarize(fixture('result-format-5-tts.jsonl'))).sentences).toBe(3)
    expect(tts(summarize(fixture('result-format-6-tts.jsonl'))).sentences).toBe(3)
    expect(tts(summarize(fixture('result-format-8-tts.jsonl'))).sentences).toBe(3)
    expect(tts(summarize(fixture('result-format-9-tts.jsonl'))).run.reference?.name).toBe('bright-young-woman-30s')
    expect(tts(summarize(fixture('result-format-8-tts.jsonl'))).run.reference).toBeNull()
    expect(tts(summarize(fixture('result-format-9-tts.jsonl'))).run.durationScale).toBeNull()
    expect(tts(summarize(fixture('result-format-10-tts.jsonl'))).run.durationScale).toBe(0.5)
    expect(tts(summarize(fixture('result-format-11-tts.jsonl'))).run.durationScale).toBe(0.5)
  })

  const ttsRun = { type: 'run', format: 4, task: 'tts', set: { name: 'speak', locale: 'ja-JP', size: 2 }, voice: 'ono_anna', recognizer: { id: 'r', label: 'R' }, loadSeconds: 1, warmupSeconds: 1 }
  const sentence = (text: string, transcript: string, firstAudioSeconds: number, totalSeconds: number, audioSeconds: number) =>
    JSON.stringify({ type: 'sentence', id: text, kind: 'reply', text, audio: `${text}.wav`, audioSeconds, firstAudioSeconds, totalSeconds, transcript })

  it('adds up what was misheard, the time to the first audio and the pace of the speech', () => {
    const summary = tts(summarize([JSON.stringify(ttsRun), sentence('はい', 'はい', 0.05, 0.3, 0.5), sentence('こんにちは', 'こんばんは', 0.07, 0.5, 1.5)]))
    expect(summary.errorRate).toBeCloseTo(2 / 7)
    expect(summary.medianFirstAudioSeconds).toBeCloseTo(0.05)
    expect(summary.realTimeFactor).toBeCloseTo(0.8 / 2)
    expect(summary.secondsPerCharacter).toBeCloseTo(2 / 7)
  })
})
