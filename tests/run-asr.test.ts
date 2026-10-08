import { describe, expect, it } from 'vitest'
import { modelRecord, prepareAudio } from '../src/measure/run-asr.ts'

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

describe('modelRecord', () => {
  it('names a converted file by the checkpoint it was made from and the converter that made it, and a download by where it was', () => {
    const converted = { kind: 'converted', converter: { id: 'converter', repository: 'https://example.com/converter', commit: 'c0ffee', script: 'convert.py' }, checkpoint: { kind: 'model', repo: 'org/model', revision: 'abc', file: 'model.nemo', bytes: 10, sha256: 'checkpoint' }, args: ['--outtype', 'fp16'], file: 'model.f16.gguf', bytes: 5, sha256: 'converted' } as const
    const downloaded = { kind: 'model', repo: 'org/model-GGUF', revision: 'def', file: 'model-F16.gguf', bytes: 5, sha256: 'downloaded' } as const
    expect(modelRecord({ id: 'model', label: 'Model', license: 'MIT', files: [converted, downloaded] }).files).toEqual([
      { source: 'huggingface', repo: 'org/model', revision: 'abc', file: 'model.f16.gguf', sha256: 'converted', converter: { repository: 'https://example.com/converter', commit: 'c0ffee', args: ['--outtype', 'fp16'] } },
      { source: 'huggingface', repo: 'org/model-GGUF', revision: 'def', file: 'model-F16.gguf', sha256: 'downloaded', converter: null }
    ])
  })

  it('names a local file by its name, size and sha256, as a local file and without the path it was read from', () => {
    const local = { kind: 'local', path: '/models/quantized/model-Q6_K.gguf', file: 'model-Q6_K.gguf', bytes: 7, sha256: 'local' } as const
    expect(modelRecord({ id: 'model', label: 'Model', license: 'MIT', files: [local] }).files).toEqual([{ source: 'local', file: 'model-Q6_K.gguf', bytes: 7, sha256: 'local' }])
  })
})
