/** Recordings are kept at the rate the recognizers take. */
export const RATE = 16_000
/** The meter spans this many decibels below full scale. */
export const FLOOR_DB = -60
/** Speech whose loudest sample stays below this is too quiet to measure well. */
export const QUIET_DB = -35
/** Above this the meter warns that the level is near clipping. */
export const HOT_DB = -3
/** A sample this close to full scale is taken as clipped. */
export const CLIP = 0.99

export const decibels = (amplitude: number): number => (amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity)
export const formatDb = (db: number): string => (Number.isFinite(db) ? `${db.toFixed(0)} dBFS` : '−∞ dBFS')
/** Where a level falls on the meter, from 0 to 100. */
export const meterShare = (db: number): number => Math.max(0, Math.min(100, ((db - FLOOR_DB) / -FLOOR_DB) * 100))

export interface Take {
  samples: Float32Array
  seconds: number
  peakDb: number
  noiseDb: number
  clipped: boolean
}

/**
 * The loudest sample, the level of the quietest stretch (the room without the voice) and whether it clipped.
 * Stretches of exact zeros are left out of the room: the microphone delivers them while it starts, for about
 * 150 ms at the head of a recording.
 */
export function takeOf(samples: Float32Array): Take {
  let peak = 0
  let clipped = false
  for (const sample of samples) {
    const size = Math.abs(sample)
    if (size > peak) peak = size
    if (size >= CLIP) clipped = true
  }
  const frame = RATE / 50
  const frames: number[] = []
  for (let from = 0; from + frame <= samples.length; from += frame) {
    let sum = 0
    for (let i = from; i < from + frame; i++) sum += samples[i]! * samples[i]!
    if (sum > 0) frames.push(Math.sqrt(sum / frame))
  }
  frames.sort((a, b) => a - b)
  return { samples, seconds: samples.length / RATE, peakDb: decibels(peak), noiseDb: decibels(frames[Math.floor(frames.length * 0.1)] ?? 0), clipped }
}

export type Verdict = { text: string; kind: 'ok' | 'warn' | 'bad' }

export function verdictOf(take: Take): Verdict {
  if (take.clipped) return { text: 'Clipped: lower the input level and record again.', kind: 'bad' }
  if (take.peakDb < QUIET_DB) return { text: 'Too quiet: move closer or raise the input level, and record again.', kind: 'warn' }
  return { text: 'Level is fine.', kind: 'ok' }
}

/** Joins the captured chunks and resamples them to 16 kHz with the browser's own resampler. */
export async function toSixteenKilohertz(chunks: readonly Float32Array[], rate: number): Promise<Float32Array> {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const joined = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.length
  }
  const offline = new OfflineAudioContext(1, Math.ceil((length * RATE) / rate), RATE)
  const buffer = offline.createBuffer(1, length, rate)
  buffer.copyToChannel(joined, 0)
  const source = offline.createBufferSource()
  source.buffer = buffer
  source.connect(offline.destination)
  source.start()
  return (await offline.startRendering()).getChannelData(0)
}

/** A 16 kHz mono 16-bit WAVE file of the samples. */
export function wav16(samples: Float32Array): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, RATE, true)
  view.setUint32(28, RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true))
  return new Blob([view.buffer], { type: 'audio/wav' })
}

/** A saved recording, decoded at 16 kHz. */
export async function decodeTake(url: string): Promise<Take> {
  const bytes = await (await fetch(url, { cache: 'no-store' })).arrayBuffer()
  const buffer = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes)
  return takeOf(buffer.getChannelData(0))
}
