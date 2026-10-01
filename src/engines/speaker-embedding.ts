import type { OnnxModel } from '../catalog/models.ts'
import { ensurePinned } from '../catalog/store.ts'
import { resample, type Pcm } from '../core/wav.ts'
import { loadSherpa, type SherpaAddon } from './sherpa-onnx.ts'

/**
 * A speaker embedding model loaded in this process through sherpa-onnx. Audio is resampled to 16 kHz first:
 * the addon would resample it too, but it writes a line to the terminal for every utterance it does.
 */
export class SpeakerEmbedder {
  readonly model: OnnxModel
  private readonly addon: SherpaAddon
  private readonly extractor: unknown

  private constructor(model: OnnxModel, addon: SherpaAddon, extractor: unknown) {
    this.model = model
    this.addon = addon
    this.extractor = extractor
  }

  static async open(model: OnnxModel): Promise<SpeakerEmbedder> {
    const addon = await loadSherpa()
    const onnx = await ensurePinned(model.file)
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
