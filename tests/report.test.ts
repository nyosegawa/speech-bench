import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeRuntime, formatReport, percentiles, summarize as summarizeFile, type AsrSummary, type Summary, type TtsSummary } from '../src/measure/report.ts'
import { countHeardErrors } from '../src/measure/heard.ts'
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
    expect(summary.inverseRealTimeFactor).toBeCloseTo(10)
  })

  it('counts the utterances dropped by the VAD apart, leaving them out of the error rate and the timings', () => {
    const dropped = JSON.stringify({ type: 'utterance', id: 'short-hai', reference: 'はい', droppedBy: 'energy-vad' })
    const summary = asr(summarize([JSON.stringify(asrRun), dropped, utterance('かきくけこ', 'かきくけ', 0.4, 4)], noSpellings))
    expect(summary.utterances).toBe(2)
    expect(summary.dropped).toBe(1)
    expect(summary.errorRate).toBeCloseTo(1 / 5)
    expect(summary.empty).toBe(0)
    expect(summary.latencySeconds).toEqual({ p50: 0.4, p90: 0.4, p99: 0.4 })
    expect(summary.inverseRealTimeFactor).toBeCloseTo(10)
  })

  it('counts transcriptions that came back empty', () => {
    expect(asr(summarize([JSON.stringify(asrRun), utterance('あいう', '', 0.1, 1), utterance('あいう', 'あいう', 0.1, 1)], noSpellings)).empty).toBe(1)
  })

  it('names the commit of a local build that ran in place of a release, and reads a run of format 12 as the release\'s', () => {
    const local = asr(summarize(fixture('v13-asr.jsonl'), noSpellings))
    expect(local.run.runtime.build).toEqual({ commit: '596b8d8c1f2a0000000000000000000000000000', ciRun: null })
    expect(formatReport([local])).toContain('| speech.cpp 0.7.1, local build 596b8d8c1f2a |')
    const released = asr(summarize(fixture('v12-asr.jsonl'), noSpellings))
    expect(released.run.runtime.build).toBeNull()
    expect(formatReport([released])).toContain('| crispasr v0.8.38 |')
  })

  it('reads every file of format 13 as one published on Hugging Face', () => {
    const run = asr(summarize(fixture('v13-asr-converted.jsonl'), noSpellings)).run
    expect(run.model.files.map((file) => file.source)).toEqual(['huggingface'])
  })

  it('tells a build of speech.cpp\'s CI from a local build of the same commit', () => {
    const { runtime } = asr(summarize(fixture('v14-asr-ci-build.jsonl'), noSpellings)).run
    expect(runtime.build).toEqual({ commit: 'f5ab84c1710d919ad68293b6ff8897444d832939', ciRun: 37705728430 })
    expect(describeRuntime(runtime)).toContain('f5ab84c1710d')
    expect(describeRuntime(runtime)).not.toBe(describeRuntime({ ...runtime, build: { ...runtime.build!, ciRun: null } }))
  })

  it('tells two runs of speech.cpp\'s CI on the same commit apart', () => {
    const { runtime } = asr(summarize(fixture('v14-asr-ci-build.jsonl'), noSpellings)).run
    expect(describeRuntime(runtime)).not.toBe(describeRuntime({ ...runtime, build: { ...runtime.build!, ciRun: 37705728431 } }))
  })

  it('reads a run trimmed to the voice, with an utterance in which no voice was found', () => {
    const run = asr(summarize(fixture('v12-asr.jsonl'), noSpellings))
    expect(run.run.audio).toEqual({ edges: 'voice', detector: 'silero-vad-v4', marginSeconds: 0.2 })
    expect(run.dropped).toBe(1)
    expect(formatReport([run])).toContain('trimmed to the voice silero-vad-v4 finds, with 0.2 s around it')
  })
})

describe('the memory a runtime took', () => {
  const columns = (report: string, row: number): Record<string, string> => {
    const lines = report.split('\n').filter((line) => line.startsWith('|'))
    const cells = (line: string): string[] => line.split('|').slice(1, -1).map((cell) => cell.trim())
    const headers = cells(lines[0]!)
    return Object.fromEntries(cells(lines[row + 2]!).map((cell, index) => [headers[index]!, cell]))
  }

  it('gives the peak resident memory and the GPU memory in GiB, the GPU\'s named for what a Mac or Windows measures', () => {
    const mac = columns(formatReport([asr(summarize(fixture('v15-asr.jsonl'), noSpellings))]), 0)
    expect(mac['Peak memory GiB']).toBe('2.01')
    expect(mac['GPU memory (Metal) GiB']).toBe('0.04')
    const windows = columns(formatReport([tts(summarize(fixture('v15-tts.jsonl'), noSpellings))]), 0)
    expect(windows['Peak memory GiB']).toBe('1.20')
    expect(windows['VRAM GiB']).toBe('2.20')
  })

  it('says a run made before memory was measured was not, rather than give a zero', () => {
    const old = columns(formatReport([asr(summarize(fixture('v14-asr-ci-build.jsonl'), noSpellings))]), 0)
    expect(old['Peak memory GiB']).toBe('not measured')
    expect(Object.entries(old).find(([header]) => header.includes('VRAM'))?.[1]).toBe('not measured')
  })

  it('gives a Mac\'s resident and Metal memory together as the peak of their sum the run recorded', () => {
    const mac = columns(formatReport([asr(summarize(fixture('v21-asr.jsonl'), noSpellings))]), 0)
    expect(mac['Memory (RSS + Metal) GiB']).toBe('2.04')
  })

  it('gives the sum of the two peaks of a Mac run made before the peak of their sum was recorded, marked as an upper bound', () => {
    const summary = asr(summarize(fixture('v19-asr-plan.jsonl'), noSpellings))
    expect(summary.run.memory?.gpu).toEqual({ measure: 'metal', peakBytes: 44040192, peakTotalBytes: null })
    const report = formatReport([summary])
    expect(columns(report, 0)['Memory (RSS + Metal) GiB']).toBe('≤ 2.05')
    expect(report).toContain('written ≤ is the sum of the two peaks')
    expect(formatReport([asr(summarize(fixture('v21-asr.jsonl'), noSpellings))])).not.toContain('≤')
  })

  it('gives no resident and GPU memory together on Windows, where they are different memories', () => {
    const windows = tts(summarize(fixture('v20-tts.jsonl'), noSpellings))
    expect(Object.keys(columns(formatReport([windows]), 0)).some((header) => header.includes('RSS + Metal'))).toBe(false)
    const mac = asr(summarize(fixture('v21-asr.jsonl'), noSpellings))
    const asWindows = asrRunOf({ set: mac.run.set, audio: mac.run.audio, machine: windows.run.machine, memory: windows.run.memory })
    const mixed = formatReport([mac, asr(summarize([JSON.stringify(asWindows), utterance('あ', 'あ', 0.1, 1)], noSpellings))])
    expect(columns(mixed, 1)['Memory (RSS + Metal) GiB']).toBe('—')
  })

  it('says a machine without GPU memory of its own has none', () => {
    const line = JSON.stringify(asrRunOf({ memory: { intervalMs: 100, samples: 10, peakResidentBytes: 1024 ** 3, gpu: null } }))
    expect(Object.entries(columns(formatReport([asr(summarize([line, utterance('あ', 'あ', 0.1, 1)], noSpellings))]), 0)).find(([header]) => header.includes('VRAM'))?.[1]).toBe('none')
  })
})

describe('the environment of a run', () => {
  it('reads a GPU named alone, before format 16, as one whose driver was not recorded', () => {
    expect(asr(summarize(fixture('v15-asr.jsonl'), noSpellings)).run.machine.gpus).toEqual([{ name: 'Apple M5', driver: null }])
  })

  it('gives the peak and mean power of an NVIDIA GPU, and says none where a run recorded the machine without one', () => {
    const report = formatReport([tts(summarize(fixture('v16-tts.jsonl'), noSpellings)), asr(summarize(fixture('v16-asr.jsonl'), noSpellings))])
    expect(report).toContain('| 212 / 96 |')
    expect(report).toMatch(/\| none \|$/m)
  })

  it('gives the first request after loading apart from the rest', () => {
    const lines = [JSON.stringify(asrRunOf({ warmupSeconds: 2.5 })), utterance('あ', 'あ', 0.1, 1)]
    expect(formatReport([asr(summarize(lines, noSpellings))])).toContain('| 2.500 |')
  })
})

describe('streamed speech in the report', () => {
  it('gives the time between pieces and the least audio a player held, over the sentences that came in pieces', () => {
    const summary = tts(summarize(fixture('v17-tts.jsonl'), noSpellings))
    expect(summary.streaming).not.toBe('whole')
    expect(formatReport([summary])).toContain('| 0.080 / 0.080 / 0.080 |')
  })

  it('says a run whose sentences each came whole has none, and one before the pieces were recorded did not record them', () => {
    const whole = JSON.stringify({ type: 'sentence', id: 'a', kind: 'reply', text: 'はい', audio: 'a.wav', audioSeconds: 1, firstAudioSeconds: 2, totalSeconds: 2, transcript: 'はい', chunks: [{ seconds: 2, audioSeconds: 1 }] })
    expect(tts(summarize([JSON.stringify(ttsRunOf()), whole], noSpellings)).streaming).toBe('whole')
    expect(tts(summarize(fixture('v16-tts.jsonl'), noSpellings)).streaming).toBeNull()
  })
})

describe('how a run was made', () => {
  it('writes a cold load time as cold, and reads every run before format 18 as loaded as the system found its files', () => {
    expect(asr(summarize(fixture('v18-asr-cold.jsonl'), noSpellings)).run.coldLoad).toBe(true)
    expect(formatReport([asr(summarize(fixture('v18-asr-cold.jsonl'), noSpellings))])).toContain(' cold |')
    expect(tts(summarize(fixture('v17-tts.jsonl'), noSpellings)).run.coldLoad).toBe(false)
  })
})

describe('a second recognizer of synthesized speech', () => {
  it('counts what it misheard apart from the first, in a column named for it', () => {
    const summary = tts(summarize(fixture('v20-tts.jsonl'), noSpellings))
    // The second recognizer heard nothing of はい。, which the first heard right, and the rest as the first did.
    const file = parseResultFile(fixture('v20-tts.jsonl').join('\n'), 'v20')
    if (!('sentences' in file)) throw new Error('expected a synthesis result')
    const first = file.sentences.map((sentence) => sentence.transcript)
    const counts = (heard: (index: number) => string): number => {
      const all = file.sentences.map((sentence, index) => countHeardErrors(sentence.text, heard(index), 'ja-JP'))
      return all.reduce((sum, count) => sum + count.errors, 0) / all.reduce((sum, count) => sum + count.referenceLength, 0)
    }
    expect(summary.errorRate).toBeCloseTo(counts((index) => first[index]!))
    expect(summary.secondErrorRate).toBeCloseTo(counts((index) => (index === 0 ? '' : first[index]!)))
    expect(summary.secondErrorRate!).toBeGreaterThan(summary.errorRate)
    expect(formatReport([summary])).toContain('| Heard CER, ReazonSpeech NeMo v2, speech.cpp F16 |')
  })

  it('has none for a run made before it was recorded', () => {
    expect(tts(summarize(fixture('v17-tts.jsonl'), noSpellings)).secondErrorRate).toBeNull()
  })
})

describe('percentiles', () => {
  it('gives each percentile as a time that was measured, by the nearest rank', () => {
    const times = Array.from({ length: 100 }, (_, index) => (100 - index) / 100)
    expect(percentiles(times)).toEqual({ p50: 0.5, p90: 0.9, p99: 0.99 })
  })

  it('gives the slowest of fewer than a hundred times as the 99th percentile', () => {
    expect(percentiles([0.3, 0.1, 0.2])).toEqual({ p50: 0.2, p90: 0.3, p99: 0.3 })
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

  it('gives the heard error rate of each kind of sentence apart, over that kind\'s characters', () => {
    const summary = tts(summarize([JSON.stringify(ttsRun), sentence('はい', 'はい', 0.05, 0.3, 0.5), sentence('こんにちは', 'こんばんは', 0.07, 0.5, 1.5)].map((line, index) => (index === 1 ? line.replace('"reply"', '"aizuchi"') : line)), noSpellings))
    expect(summary.errorRateByKind).toEqual([{ kind: 'aizuchi', sentences: 1, errorRate: 0 }, { kind: 'reply', sentences: 1, errorRate: 2 / 5 }])
    expect(formatReport([summary])).toMatch(/\| aizuchi \(1\) \| reply \(1\) \|\n.*\n.*\| 0\.00% \| 40\.00% \|/)
  })

  it('adds up what was misheard, the time to the first audio and the pace of the speech', () => {
    const summary = tts(summarize([JSON.stringify(ttsRun), sentence('はい', 'はい', 0.05, 0.3, 0.5), sentence('こんにちは', 'こんばんは', 0.07, 0.5, 1.5)], noSpellings))
    expect(summary.errorRate).toBeCloseTo(2 / 7)
    expect(summary.firstAudioSeconds.p50).toBeCloseTo(0.05)
    expect(summary.inverseRealTimeFactor).toBeCloseTo(2 / 0.8)
    expect(summary.secondsPerCharacter).toBeCloseTo(2 / 7)
  })
})
