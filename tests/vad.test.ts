import { describe, expect, it } from 'vitest'
import { ASIST_VAD, asistCaptures, cutLikeAsist, segment, type VadFrame } from '../src/vad.ts'

const RATE = 16_000

/** Audio built from stretches: a tone stands for speech, a very low noise for a quiet room. */
function audio(stretches: Array<{ seconds: number; speech: boolean }>): Float32Array {
  const parts = stretches.map(({ seconds, speech }) =>
    Float32Array.from({ length: Math.round(seconds * RATE) }, (_, index) => (speech ? 0.3 * Math.sin((2 * Math.PI * 200 * index) / RATE) : 0.001 * Math.sin(index))))
  const samples = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    samples.set(part, offset)
    offset += part.length
  }
  return samples
}

const FRAME_SECONDS = 341 / RATE

describe('cutLikeAsist', () => {
  it('keeps 300 ms before the speech and the hangover after it', () => {
    const cut = cutLikeAsist({ sampleRate: RATE, samples: audio([{ seconds: 1, speech: false }, { seconds: 1, speech: true }, { seconds: 1, speech: false }]) }, 600)!
    expect(cut.samples.length / RATE).toBeGreaterThan(0.3 + 1 + 0.6 - 2 * FRAME_SECONDS)
    expect(cut.samples.length / RATE).toBeLessThan(0.3 + 1 + 0.6 + 2 * FRAME_SECONDS)
  })

  it('pads the hangover with silence when the recording stops right after the speech', () => {
    const cut = cutLikeAsist({ sampleRate: RATE, samples: audio([{ seconds: 1, speech: false }, { seconds: 1, speech: true }]) }, 600)!
    expect(cut.samples.length / RATE).toBeGreaterThan(0.3 + 1 + 0.6 - 2 * FRAME_SECONDS)
    expect(cut.samples.at(-1)).toBe(0)
  })

  it('keeps a pause shorter than the hangover inside one capture', () => {
    const samples = audio([{ seconds: 0.5, speech: false }, { seconds: 1, speech: true }, { seconds: 0.4, speech: false }, { seconds: 1, speech: true }, { seconds: 1, speech: false }])
    expect(asistCaptures({ sampleRate: RATE, samples }, 600)).toHaveLength(1)
  })

  it('drops a click too short to be kept, as ASIST drops it', () => {
    const samples = audio([{ seconds: 0.5, speech: false }, { seconds: 0.05, speech: true }, { seconds: 2, speech: false }, { seconds: 1, speech: true }, { seconds: 1, speech: false }])
    const captures = asistCaptures({ sampleRate: RATE, samples }, 600)
    expect(captures).toHaveLength(1)
    expect(captures[0]!.start / RATE).toBeGreaterThan(2)
  })

  it('keeps nothing of a short answer with less voice than ASIST requires, which ASIST never sends', () => {
    const shortAnswer = audio([{ seconds: 0.5, speech: false }, { seconds: 0.2, speech: true }, { seconds: 1.5, speech: false }])
    expect(cutLikeAsist({ sampleRate: RATE, samples: shortAnswer }, 600)).toBeNull()
    expect(cutLikeAsist({ sampleRate: RATE, samples: audio([{ seconds: 2, speech: false }]) }, 600)).toBeNull()
  })
})

describe('segment', () => {
  /** 20 ms frames over audio of constant levels, with the state ASIST had for each. */
  function frames(levels: number[], context: Partial<Omit<VadFrame, 'start' | 'end'>>[] = []): { pcm: { sampleRate: number; samples: Float32Array }; frames: VadFrame[] } {
    const samples = new Float32Array(levels.length * 320)
    levels.forEach((level, index) => samples.fill(level, index * 320, (index + 1) * 320))
    return {
      pcm: { sampleRate: RATE, samples },
      frames: levels.map((_, index) => ({ start: index * 320, end: (index + 1) * 320, prob: null, boost: 1, muted: false, hangoverMs: 600, ...context[index] }))
    }
  }
  const room = (count: number): number[] => Array<number>(count).fill(0.0005)

  it('drops a loud stretch Silero does not take for a voice, as ASIST drops a run of keystrokes', () => {
    const levels = [...room(50), ...Array<number>(25).fill(0.1), ...room(40)]
    const { pcm, frames: all } = frames(levels, levels.map((level) => ({ prob: level > 0.01 ? 0.1 : 0 })))
    expect(segment(pcm, all).map((capture) => capture.outcome)).toEqual(['dropped'])
  })

  it('opens no capture on a sound under the threshold the playback boost raised', () => {
    const levels = [...room(50), ...Array<number>(25).fill(0.02), ...room(40)]
    const { pcm, frames: all } = frames(levels, levels.map(() => ({ boost: 3 })))
    expect(segment(pcm, all)).toEqual([])
  })

  it('ends a capture a mute cuts into without keeping it, and opens a new one after the mute', () => {
    const levels = [...room(50), ...Array<number>(50).fill(0.1), ...room(40)]
    const { pcm, frames: all } = frames(levels, levels.map((_, index) => ({ muted: index >= 60 && index < 70 })))
    expect(segment(pcm, all).map((capture) => capture.outcome)).toEqual(['muted', 'kept'])
  })

  it('keeps a soft voice under the fixed lower threshold only when the candidate threshold is lower', () => {
    const soft = [...room(100), ...Array<number>(40).fill(0.008), ...room(40)]
    const { pcm, frames: all } = frames(soft)
    expect(segment(pcm, all)).toEqual([])
    expect(segment(pcm, all, { ...ASIST_VAD, minThreshold: 0.004 }).map((capture) => capture.outcome)).toEqual(['kept'])
  })
})
