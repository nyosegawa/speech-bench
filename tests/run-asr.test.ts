import { describe, expect, it } from 'vitest'
import { prepareAudio } from '../src/measure/run-asr.ts'

const recording = { sampleRate: 100, samples: Float32Array.from({ length: 300 }, (_, index) => (index >= 100 && index < 200 ? 0.3 : 0.001)) }
const trim = { edges: 'voice', detector: 'silero-vad-v4', marginSeconds: 0.2 } as const

describe('prepareAudio', () => {
  it('trims to the voice the detector finds with the margin around it, at a peak of 0.9', () => {
    const prepared = prepareAudio(recording, trim, { voiceSpan: () => ({ start: 100, end: 200 }) })!
    expect(prepared.samples.length).toBe(140)
    expect(Math.max(...prepared.samples)).toBeCloseTo(0.9, 5)
  })

  it('gives nothing to hear when the detector finds no voice', () => {
    expect(prepareAudio(recording, trim, { voiceSpan: () => null })).toBeNull()
  })

  it('sends a recording as recorded with the silence asked for after it', () => {
    expect(prepareAudio(recording, { edges: 'as-recorded', trailingSilence: 1 }, null)!.samples.length).toBe(400)
  })
})
