import { describe, expect, it } from 'vitest'
import { encodeWav16, peakNormalize, readWav, resample, trimAround, withTrailingSilence } from '../src/wav.ts'

/** A WAVE file of 32-bit float samples with a fact chunk, laid out like the files of FLEURS. */
function floatWav(channels: number, sampleRate: number, samples: number[]): Buffer {
  const fmt = Buffer.alloc(8 + 18)
  fmt.write('fmt ', 0)
  fmt.writeUInt32LE(18, 4)
  fmt.writeUInt16LE(3, 8)
  fmt.writeUInt16LE(channels, 10)
  fmt.writeUInt32LE(sampleRate, 12)
  fmt.writeUInt32LE(sampleRate * channels * 4, 16)
  fmt.writeUInt16LE(channels * 4, 20)
  fmt.writeUInt16LE(32, 22)
  const fact = Buffer.alloc(12)
  fact.write('fact', 0)
  fact.writeUInt32LE(4, 4)
  fact.writeUInt32LE(samples.length / channels, 8)
  const data = Buffer.alloc(8 + samples.length * 4)
  data.write('data', 0)
  data.writeUInt32LE(samples.length * 4, 4)
  samples.forEach((sample, index) => data.writeFloatLE(sample, 8 + index * 4))
  const header = Buffer.alloc(12)
  header.write('RIFF', 0)
  header.writeUInt32LE(4 + fmt.length + fact.length + data.length, 4)
  header.write('WAVE', 8)
  return Buffer.concat([header, fmt, fact, data])
}

describe('readWav', () => {
  it('reads 32-bit float samples past a fact chunk', () => {
    const pcm = readWav(floatWav(1, 16_000, [0.5, -0.25, 0]))
    expect(pcm.sampleRate).toBe(16_000)
    expect([...pcm.samples]).toEqual([0.5, -0.25, 0])
  })

  it('mixes several channels down to one', () => {
    expect([...readWav(floatWav(2, 16_000, [0.5, 0, -1, 1])).samples]).toEqual([0.25, 0])
  })

  it('reads back the 16-bit file it writes', () => {
    const samples = Float32Array.from([0, 0.5, -0.5, 0.999])
    const pcm = readWav(encodeWav16({ sampleRate: 16_000, samples }))
    expect(pcm.sampleRate).toBe(16_000)
    pcm.samples.forEach((sample, index) => expect(sample).toBeCloseTo(samples[index]!, 4))
  })
})

describe('withTrailingSilence', () => {
  it('appends silence of the given length and keeps the audio', () => {
    const padded = withTrailingSilence({ sampleRate: 16_000, samples: Float32Array.from([0.1, 0.2]) }, 0.5)
    expect(padded.samples.length).toBe(2 + 8_000)
    expect(padded.samples[1]).toBeCloseTo(0.2)
    expect(padded.samples[8_001]).toBe(0)
  })
})

describe('peakNormalize', () => {
  it('scales quiet audio to a peak of 0.9, so that every model hears an utterance at one level', () => {
    const scaled = peakNormalize({ sampleRate: 16_000, samples: Float32Array.from([0.1, -0.3, 0.2]) })
    expect([...scaled.samples].map((sample) => Number(sample.toFixed(4)))).toEqual([0.3, -0.9, 0.6])
  })

  it('leaves loud and silent audio as it is', () => {
    const loud = { sampleRate: 16_000, samples: Float32Array.from([0.95, -0.2]) }
    expect(peakNormalize(loud)).toBe(loud)
    const silent = { sampleRate: 16_000, samples: new Float32Array(4) }
    expect(peakNormalize(silent)).toBe(silent)
  })
})

describe('resample', () => {
  const tone = (frequency: number, sampleRate: number, seconds: number) => ({
    sampleRate,
    samples: Float32Array.from({ length: sampleRate * seconds }, (_, index) => 0.5 * Math.sin((2 * Math.PI * frequency * index) / sampleRate))
  })
  const rms = (samples: Float32Array, from: number, to: number) => Math.sqrt(samples.slice(from, to).reduce((sum, sample) => sum + sample * sample, 0) / (to - from))

  it('keeps a tone the new rate can hold, at its level', () => {
    const down = resample(tone(1_000, 48_000, 1), 16_000)
    expect(down.samples.length).toBe(16_000)
    expect(rms(down.samples, 1_000, 15_000)).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })

  it('removes a tone above the new Nyquist frequency instead of folding it into the speech band', () => {
    const down = resample(tone(10_000, 48_000, 1), 16_000)
    expect(rms(down.samples, 1_000, 15_000)).toBeLessThan(0.02)
  })

  it('raises the rate without changing the level', () => {
    const up = resample(tone(1_000, 16_000, 1), 24_000)
    expect(up.samples.length).toBe(24_000)
    expect(rms(up.samples, 1_500, 22_500)).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })
})

describe('trimAround', () => {
  const pcm = { sampleRate: 10, samples: Float32Array.from({ length: 50 }, (_, index) => index) }

  it('keeps the margin of the recording before and after the stretch', () => {
    expect([...trimAround(pcm, 20, 30, 0.5).samples]).toEqual(Array.from({ length: 20 }, (_, index) => index + 15))
  })

  it('stops at the ends of the recording', () => {
    const trimmed = trimAround(pcm, 2, 48, 0.5)
    expect(trimmed.samples[0]).toBe(0)
    expect(trimmed.samples.length).toBe(50)
  })
})
