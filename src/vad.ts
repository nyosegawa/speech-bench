import type { Pcm } from './wav.ts'

/** The values of ASIST's VAD (src/renderer/src/voice/VadSegmenter.ts) that decide what it captures and keeps. */
export interface VadValues {
  /** The RMS the threshold never goes below, however quiet the room. */
  minThreshold: number
  /** How far above the noise floor a frame has to be to count as voiced. */
  speechRatio: number
  noiseFloorInit: number
  /** How fast the noise floor follows the quiet frames between captures. */
  noiseFloorAlpha: number
  /** The length a kept capture needs without its closing silence. */
  minUtteranceMs: number
  minVoicedMs: number
  /** The voiced time Silero VAD has to confirm as a voice. */
  minSpeechMs: number
}

export const ASIST_VAD: VadValues = {
  minThreshold: 0.012,
  speechRatio: 3.0,
  noiseFloorInit: 0.008,
  noiseFloorAlpha: 0.05,
  minUtteranceMs: 300,
  minVoicedMs: 250,
  minSpeechMs: 150
}

const PRE_ROLL_MS = 300
const MAX_UTTERANCE_MS = 20_000
/** A voiced frame counts as speech when Silero VAD's voice probability reaches this. */
const SPEECH_PROB_THRESHOLD = 0.5

/** ASIST's default hangover (src/main/services/settings.ts), the silence that closes an utterance. */
export const ASIST_HANGOVER_MS = 600

/**
 * One frame as ASIST's VAD received it, as sample offsets into the audio, with what ASIST knew besides the
 * audio: Silero's voice probability (null while Silero is not ready, when energy alone decides), the boost
 * of the threshold while the assistant speaks, whether the VAD was muted, and the hangover in force.
 */
export interface VadFrame {
  start: number
  end: number
  prob: number | null
  boost: number
  muted: boolean
  hangoverMs: number
}

/**
 * A capture the VAD opened, as sample offsets: `start` with the pre-roll, `opened` at the frame that opened
 * it, and `end` with the closing silence, which may pass the end of the audio.
 */
export interface Capture {
  start: number
  opened: number
  end: number
  /** kept goes to speech recognition; dropped had too little voice; muted was cut off by a mute. */
  outcome: 'kept' | 'dropped' | 'muted'
  voicedMs: number
  speechMs: number
  /** The RMS of the loudest frame in the capture. */
  loudest: number
  /** The noise floor the capture opened on. */
  noiseFloor: number
}

export const frameRms = (samples: Float32Array, from: number, to: number): number => {
  let sum = 0
  for (let index = from; index < to; index++) sum += (samples[index] ?? 0) ** 2
  return Math.sqrt(sum / Math.max(1, to - from))
}

/**
 * The captures ASIST's VAD opens in this audio, frame by frame as ASIST decides them. A capture starts at
 * the first frame above the adaptive noise floor, keeps up to 300 ms before it, and closes once silence has
 * lasted the hangover, which stays in the capture, or at 20 s. The noise floor learns only from the quiet
 * frames outside a capture; it starts where ASIST's stood when the audio began, which is noiseFloorInit only
 * for a VAD that has just been created. Audio that ends inside a capture is followed by the silence the
 * microphone keeps delivering, so that capture closes a full hangover after its last voiced frame.
 */
export function segment(pcm: Pcm, frames: readonly VadFrame[], values: VadValues = ASIST_VAD, startFloor = values.noiseFloorInit): Capture[] {
  const toMs = (samples: number): number => (samples / pcm.sampleRate) * 1000
  const preRollSamples = (PRE_ROLL_MS / 1000) * pcm.sampleRate
  const captures: Capture[] = []
  let noiseFloor = startFloor
  let preRoll: VadFrame[] = []
  let preRollLength = 0
  let open: { start: number; opened: number; samples: number; silenceMs: number; voicedMs: number; speechMs: number; loudest: number; noiseFloor: number } | null = null
  const close = (end: number, outcome: Capture['outcome']): void => {
    if (!open) return
    captures.push({ start: open.start, opened: open.opened, end, outcome, voicedMs: open.voicedMs, speechMs: open.speechMs, loudest: open.loudest, noiseFloor: open.noiseFloor })
    open = null
  }
  const keeps = (capture: NonNullable<typeof open>): boolean =>
    toMs(capture.samples) - Math.round(capture.silenceMs) >= values.minUtteranceMs && capture.voicedMs >= values.minVoicedMs && capture.speechMs >= values.minSpeechMs
  for (const frame of frames) {
    if (frame.muted) {
      close(frame.start, 'muted')
      continue
    }
    const level = frameRms(pcm.samples, frame.start, frame.end)
    const threshold = Math.max(values.minThreshold, noiseFloor * values.speechRatio) * frame.boost
    const frameMs = toMs(frame.end - frame.start)
    if (!open) {
      if (level <= threshold) noiseFloor = noiseFloor * (1 - values.noiseFloorAlpha) + level * values.noiseFloorAlpha
      preRoll.push(frame)
      preRollLength += frame.end - frame.start
      // ASIST drops the oldest frame only while what remains still covers the pre-roll. A mute leaves the
      // pre-roll as it was, so it can hold frames from before the mute.
      while (preRollLength - (preRoll[0]!.end - preRoll[0]!.start) > preRollSamples) {
        const oldest = preRoll.shift()!
        preRollLength -= oldest.end - oldest.start
      }
      if (level > threshold) {
        open = { start: preRoll[0]!.start, opened: frame.start, samples: preRollLength, silenceMs: 0, voicedMs: 0, speechMs: 0, loudest: level, noiseFloor }
        preRoll = []
        preRollLength = 0
      }
      continue
    }
    open.samples += frame.end - frame.start
    open.loudest = Math.max(open.loudest, level)
    if (level > threshold) {
      open.silenceMs = 0
      open.voicedMs += frameMs
      if (frame.prob === null || frame.prob >= SPEECH_PROB_THRESHOLD) open.speechMs += frameMs
    } else {
      open.silenceMs += frameMs
    }
    if (open.silenceMs >= frame.hangoverMs || toMs(open.samples) >= MAX_UTTERANCE_MS) close(frame.end, keeps(open) ? 'kept' : 'dropped')
  }
  const last = frames.at(-1)
  if (open && last) {
    const remaining: NonNullable<typeof open> = open
    const padding = Math.max(0, Math.round(((last.hangoverMs - remaining.silenceMs) / 1000) * pcm.sampleRate))
    remaining.samples += padding
    remaining.silenceMs = last.hangoverMs
    close(last.end + padding, keeps(remaining) ? 'kept' : 'dropped')
  }
  return captures
}

/** The frames a 48 kHz microphone delivers to ASIST's VAD: 1024 samples at the device rate, about 341 at 16 kHz. */
export function microphoneFrames(pcm: Pcm, hangoverMs: number): VadFrame[] {
  if (pcm.sampleRate !== 16_000) throw new Error(`ASIST's VAD runs at 16 kHz, not ${pcm.sampleRate} Hz`)
  const frames: VadFrame[] = []
  for (let start = 0; start < pcm.samples.length; start += 341) {
    frames.push({ start, end: Math.min(start + 341, pcm.samples.length), prob: null, boost: 1, muted: false, hangoverMs })
  }
  return frames
}

/**
 * The captures ASIST's VAD would keep in this audio, by energy alone. Silero VAD, which ASIST uses only to
 * confirm that the energy is a voice, and the VAP, which moves the hangover, are left out: they do not move
 * the edges of an utterance that is plainly speech.
 */
export const asistCaptures = (pcm: Pcm, hangoverMs: number, values: VadValues = ASIST_VAD): Capture[] =>
  segment(pcm, microphoneFrames(pcm, hangoverMs), values).filter((capture) => capture.outcome === 'kept')

/**
 * The audio from the start of ASIST's first capture to the end of its last one, padded with silence where
 * the hangover runs past the end of the recording. This is the audio ASIST sends for a clip spoken as one
 * utterance; pauses longer than the hangover, which ASIST would split at, are kept inside. Null when ASIST
 * keeps no capture at all, as for a short answer with less voice than it requires, which ASIST never sends.
 */
export function cutLikeAsist(pcm: Pcm, hangoverMs: number): Pcm | null {
  const captures = asistCaptures(pcm, hangoverMs)
  const first = captures[0]
  const last = captures.at(-1)
  if (!first || !last) return null
  const samples = new Float32Array(last.end - first.start)
  samples.set(pcm.samples.subarray(first.start, Math.min(last.end, pcm.samples.length)))
  return { sampleRate: pcm.sampleRate, samples }
}
