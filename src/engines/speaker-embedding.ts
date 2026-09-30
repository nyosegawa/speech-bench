import { createRequire } from 'node:module'
import type { SpeakerModel } from '../catalog.ts'
import { ensureRuntime, SHERPA_ONNX } from '../runtimes.ts'
import { ensurePinned } from '../store.ts'
import { resample, type Pcm } from '../wav.ts'

/** The functions of sherpa-onnx's addon the bench calls, as its JavaScript wrapper calls them (v1.13.8). */
interface SherpaAddon {
  createSpeakerEmbeddingExtractor(config: { model: string; numThreads: number; debug: number; provider: string }): unknown
  speakerEmbeddingExtractorCreateStream(extractor: unknown): unknown
  acceptWaveformOnline(stream: unknown, wave: { samples: Float32Array; sampleRate: number }): void
  inputFinished(stream: unknown): void
  speakerEmbeddingExtractorIsReady(extractor: unknown, stream: unknown): boolean
  speakerEmbeddingExtractorComputeEmbedding(extractor: unknown, stream: unknown, enableExternalBuffer: boolean): Float32Array
}

/**
 * A speaker embedding model loaded in this process through sherpa-onnx. Audio is resampled to 16 kHz first:
 * the addon would resample it too, but it writes a line to the terminal for every utterance it does.
 */
export class SpeakerEmbedder {
  readonly model: SpeakerModel
  private readonly addon: SherpaAddon
  private readonly extractor: unknown

  private constructor(model: SpeakerModel, addon: SherpaAddon, extractor: unknown) {
    this.model = model
    this.addon = addon
    this.extractor = extractor
  }

  static async open(model: SpeakerModel): Promise<SpeakerEmbedder> {
    const addonFile = await ensureRuntime(SHERPA_ONNX)
    const onnx = await ensurePinned(model.file)
    const addon = createRequire(import.meta.url)(addonFile) as SherpaAddon
    return new SpeakerEmbedder(model, addon, addon.createSpeakerEmbeddingExtractor({ model: onnx, numThreads: 2, debug: 0, provider: 'cpu' }))
  }

  embed(pcm: Pcm): Float32Array {
    const stream = this.addon.speakerEmbeddingExtractorCreateStream(this.extractor)
    const audio = resample(pcm, 16_000)
    this.addon.acceptWaveformOnline(stream, { samples: audio.samples, sampleRate: audio.sampleRate })
    this.addon.inputFinished(stream)
    if (!this.addon.speakerEmbeddingExtractorIsReady(this.extractor, stream)) throw new Error(`${this.model.id} needs a longer utterance to embed`)
    // Without the external buffer the addon copies the embedding, which otherwise belongs to the stream.
    return this.addon.speakerEmbeddingExtractorComputeEmbedding(this.extractor, stream, false)
  }
}
