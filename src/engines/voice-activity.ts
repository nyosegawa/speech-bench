import type { OnnxModel } from '../catalog.ts'
import { ensurePinned } from '../store.ts'
import { resample, type Pcm } from '../wav.ts'
import { loadSherpa, type SherpaAddon } from './sherpa-onnx.ts'

/**
 * Silero's settings for finding the voice of a whole utterance. A stretch of voice counts from 0.1 s, so a
 * short はい (0.23 s of voice in the author's recordings) is found; the pauses and the longest stretch only
 * split the voice into segments, whose first start and last end are all that is used.
 */
const SILERO = { threshold: 0.5, minSilenceDuration: 0.3, minSpeechDuration: 0.1, windowSize: 512, maxSpeechDuration: 30 }
const RATE = 16_000

/** Where the voice of an utterance begins and ends, in samples of the audio it was found in. */
export interface VoiceSpan {
  start: number
  end: number
}

/** Silero VAD loaded in this process through sherpa-onnx. */
export class VoiceDetector {
  readonly model: OnnxModel
  private readonly addon: SherpaAddon
  private readonly file: string

  private constructor(model: OnnxModel, addon: SherpaAddon, file: string) {
    this.model = model
    this.addon = addon
    this.file = file
  }

  static async open(model: OnnxModel): Promise<VoiceDetector> {
    return new VoiceDetector(model, await loadSherpa(), await ensurePinned(model.file))
  }

  /** From the start of the first stretch of voice to the end of the last, or null when there is none. */
  voiceSpan(pcm: Pcm): VoiceSpan | null {
    const audio = resample(pcm, RATE)
    const seconds = audio.samples.length / RATE
    const detector = this.addon.createVoiceActivityDetector({ sileroVad: { model: this.file, ...SILERO }, sampleRate: RATE, numThreads: 1, provider: 'cpu', debug: 0 }, Math.ceil(seconds) + 1)
    // Given a whole utterance at once, the addon (v1.13.8) looks at its last window only: a 4.1 s recording
    // with voice from 0.73 s came back as one segment from 3.93 s. A window at a time it finds them all.
    for (let offset = 0; offset < audio.samples.length; offset += SILERO.windowSize) {
      this.addon.voiceActivityDetectorAcceptWaveform(detector, audio.samples.subarray(offset, offset + SILERO.windowSize))
    }
    this.addon.voiceActivityDetectorFlush(detector)
    let start = Infinity
    let end = -Infinity
    while (!this.addon.voiceActivityDetectorIsEmpty(detector)) {
      // Without the external buffer the addon copies the segment, which otherwise belongs to the detector.
      const segment = this.addon.voiceActivityDetectorFront(detector, false)
      start = Math.min(start, segment.start)
      end = Math.max(end, segment.start + segment.samples.length)
      this.addon.voiceActivityDetectorPop(detector)
    }
    if (end < start) return null
    const scale = pcm.sampleRate / RATE
    return { start: Math.floor(start * scale), end: Math.min(pcm.samples.length, Math.ceil(end * scale)) }
  }
}
