import { resample, type Pcm } from './wav.ts'

const RATE = 16_000
const FRAME = 640
const HOP = 320
const LOWEST_HZ = 70
const HIGHEST_HZ = 400

/**
 * The median pitch of a voice in hertz, by normalized autocorrelation over 40 ms frames, from 70 to 400 Hz.
 * Only frames within 20 dB of the loudest sample and periodic enough (a correlation above 0.6) count. The
 * shortest period within 90% of the best correlation is taken, because a period and its double correlate
 * almost alike and the double would halve the pitch. Null when no frame has a pitch, as for a whisper or
 * an utterance too short.
 */
export function medianPitch(pcm: Pcm): number | null {
  const samples = resample(pcm, RATE).samples
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  const shortest = Math.floor(RATE / HIGHEST_HZ)
  const longest = Math.ceil(RATE / LOWEST_HZ)
  const pitches: number[] = []
  for (let from = 0; from + FRAME <= samples.length; from += HOP) {
    let energy = 0
    for (let index = from; index < from + FRAME; index++) energy += samples[index]! ** 2
    if (Math.sqrt(energy / FRAME) < peak * 0.1) continue
    const correlations: number[] = []
    for (let lag = shortest; lag <= longest; lag++) {
      let product = 0
      let early = 0
      let late = 0
      for (let index = from; index < from + FRAME - lag; index++) {
        product += samples[index]! * samples[index + lag]!
        early += samples[index]! ** 2
        late += samples[index + lag]! ** 2
      }
      correlations.push(early > 0 && late > 0 ? product / Math.sqrt(early * late) : 0)
    }
    const best = Math.max(...correlations)
    if (best <= 0.6) continue
    const chosen = correlations.findIndex((value, index) => value >= best * 0.9 && value >= (correlations[index - 1] ?? -1) && value >= (correlations[index + 1] ?? -1))
    pitches.push(RATE / (shortest + chosen))
  }
  if (pitches.length === 0) return null
  pitches.sort((a, b) => a - b)
  return pitches[Math.floor(pitches.length / 2)]!
}

/**
 * How far apart the pitches of one voice's sentences are: their standard deviation in semitones. On
 * 2026-09-30 one speaker's 20 sentences spread 1.45 and 1.77 (Qwen3-TTS 0.6B and 1.7B, ono_anna), and
 * Irodori-TTS without a voice description, which turns from a man into a woman between sentences, 3.6 to 6.6.
 */
export function semitoneSpread(pitches: readonly number[]): number {
  if (pitches.length < 2) return 0
  const tones = pitches.map((hz) => 12 * Math.log2(hz))
  const mean = tones.reduce((sum, tone) => sum + tone, 0) / tones.length
  return Math.sqrt(tones.reduce((sum, tone) => sum + (tone - mean) ** 2, 0) / tones.length)
}
