import { createRequire } from 'node:module'
import { ensureRuntime, SHERPA_ONNX } from '../runtimes.ts'

/** The functions of sherpa-onnx's addon the bench calls, as its JavaScript wrapper calls them (v1.13.8). */
export interface SherpaAddon {
  createSpeakerEmbeddingExtractor(config: { model: string; numThreads: number; debug: number; provider: string }): unknown
  speakerEmbeddingExtractorCreateStream(extractor: unknown): unknown
  acceptWaveformOnline(stream: unknown, wave: { samples: Float32Array; sampleRate: number }): void
  inputFinished(stream: unknown): void
  speakerEmbeddingExtractorIsReady(extractor: unknown, stream: unknown): boolean
  speakerEmbeddingExtractorComputeEmbedding(extractor: unknown, stream: unknown, enableExternalBuffer: boolean): Float32Array
  createVoiceActivityDetector(config: {
    sileroVad: { model: string; threshold: number; minSilenceDuration: number; minSpeechDuration: number; windowSize: number; maxSpeechDuration: number }
    sampleRate: number
    numThreads: number
    provider: string
    debug: number
  }, bufferSizeInSeconds: number): unknown
  voiceActivityDetectorAcceptWaveform(detector: unknown, samples: Float32Array): void
  voiceActivityDetectorFlush(detector: unknown): void
  voiceActivityDetectorIsEmpty(detector: unknown): boolean
  voiceActivityDetectorFront(detector: unknown, enableExternalBuffer: boolean): { start: number; samples: Float32Array }
  voiceActivityDetectorPop(detector: unknown): void
}

/** sherpa-onnx's Node addon, fetched from its pinned npm tarball and loaded into this process. */
export async function loadSherpa(): Promise<SherpaAddon> {
  return createRequire(import.meta.url)(await ensureRuntime(SHERPA_ONNX)) as SherpaAddon
}
