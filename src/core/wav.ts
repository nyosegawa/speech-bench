/** Mono audio as floats between -1 and 1. */
export interface Pcm {
  sampleRate: number
  samples: Float32Array
}

/**
 * Reads a RIFF WAVE file of 16-bit integer or 32-bit float samples, mixing several channels down to one.
 * FLEURS ships 32-bit float files with a `fact` chunk, and recordings are 16-bit, so both are needed.
 */
export function readWav(bytes: Buffer): Pcm {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF WAVE file')
  let format: { code: number; channels: number; sampleRate: number; bits: number } | null = null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      format = { code: bytes.readUInt16LE(body), channels: bytes.readUInt16LE(body + 2), sampleRate: bytes.readUInt32LE(body + 4), bits: bytes.readUInt16LE(body + 14) }
      // WAVE_FORMAT_EXTENSIBLE keeps the real format in the first two bytes of its sub-format GUID.
      if (format.code === 0xfffe) format.code = bytes.readUInt16LE(body + 24)
    } else if (id === 'data') {
      if (!format) throw new Error('the data chunk comes before the fmt chunk')
      return { sampleRate: format.sampleRate, samples: decode(bytes.subarray(body, Math.min(body + size, bytes.length)), format) }
    }
    // Chunks are padded to an even length.
    offset = body + size + (size % 2)
  }
  throw new Error('no data chunk')
}

function decode(data: Buffer, format: { code: number; channels: number; bits: number }): Float32Array {
  const read = format.code === 1 && format.bits === 16
    ? (index: number) => data.readInt16LE(index * 2) / 32768
    : format.code === 3 && format.bits === 32
      ? (index: number) => data.readFloatLE(index * 4)
      : null
  if (!read) throw new Error(`unsupported WAVE format ${format.code} with ${format.bits}-bit samples`)
  const frames = Math.floor(data.length / (format.bits / 8) / format.channels)
  const samples = new Float32Array(frames)
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0
    for (let channel = 0; channel < format.channels; channel++) sum += read(frame * format.channels + channel)
    samples[frame] = sum / format.channels
  }
  return samples
}

/** A 16-bit mono WAVE file, the form every runtime here reads. */
export function encodeWav16(pcm: Pcm): Buffer {
  const data = Buffer.alloc(pcm.samples.length * 2)
  for (let index = 0; index < pcm.samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, pcm.samples[index] ?? 0))
    data.writeInt16LE(Math.round(sample * 32767), index * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(pcm.sampleRate, 24)
  header.writeUInt32LE(pcm.sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/**
 * The audio scaled so that its peak is 0.9, so that every model hears an utterance at one level whatever
 * it was recorded at. Audio already that loud, or silent, is returned as it is.
 */
export function peakNormalize(pcm: Pcm): Pcm {
  let peak = 0
  for (const sample of pcm.samples) peak = Math.max(peak, Math.abs(sample))
  if (peak < 1e-4 || peak >= 0.9) return pcm
  const gain = 0.9 / peak
  return { sampleRate: pcm.sampleRate, samples: pcm.samples.map((sample) => sample * gain) }
}

/**
 * The stretch from `start` to `end` with `marginSeconds` of the recording before and after it, as far as the
 * recording reaches.
 */
export function trimAround(pcm: Pcm, start: number, end: number, marginSeconds: number): Pcm {
  const margin = Math.round(marginSeconds * pcm.sampleRate)
  return { sampleRate: pcm.sampleRate, samples: pcm.samples.slice(Math.max(0, start - margin), Math.min(pcm.samples.length, end + margin)) }
}

/** The audio with this many seconds of silence after it, like the margin a VAD leaves behind an utterance. */
export function withTrailingSilence(pcm: Pcm, seconds: number): Pcm {
  const padded = new Float32Array(pcm.samples.length + Math.round(seconds * pcm.sampleRate))
  padded.set(pcm.samples)
  return { sampleRate: pcm.sampleRate, samples: padded }
}

export const durationSeconds = (pcm: Pcm): number => pcm.samples.length / pcm.sampleRate

/** Zero crossings of the sinc on each side of an output sample, at the lower of the two rates. */
const RESAMPLE_ZERO_CROSSINGS = 16

/**
 * The audio at another sample rate, through a Hann-windowed sinc whose cut-off is the lower of the two
 * Nyquist frequencies, so that going down to 16 kHz removes what 16 kHz cannot hold instead of folding it
 * back into the speech band. Each output sample is normalized by the sum of its weights, which keeps the
 * level at the edges of the audio.
 */
export function resample(pcm: Pcm, sampleRate: number): Pcm {
  if (pcm.sampleRate === sampleRate) return pcm
  const ratio = sampleRate / pcm.sampleRate
  const cutoff = Math.min(1, ratio)
  const radius = RESAMPLE_ZERO_CROSSINGS / cutoff
  const input = pcm.samples
  const output = new Float32Array(Math.round(input.length * ratio))
  for (let index = 0; index < output.length; index++) {
    const center = index / ratio
    const from = Math.max(0, Math.ceil(center - radius))
    const to = Math.min(input.length - 1, Math.floor(center + radius))
    let sum = 0
    let weights = 0
    for (let source = from; source <= to; source++) {
      const distance = source - center
      const x = distance * cutoff
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
      const weight = sinc * (0.5 + 0.5 * Math.cos((Math.PI * distance) / radius))
      sum += (input[source] ?? 0) * weight
      weights += weight
    }
    output[index] = weights === 0 ? 0 : sum / weights
  }
  return { sampleRate, samples: output }
}
