import { describe, expect, it } from 'vitest'
import { assetFor, NEMO_SPEECH_CPP_SALM, parseNemoSpeechVersion, type RuntimeSpec } from '../src/catalog/runtimes.ts'
import { presetFor } from '../src/catalog/source-build.ts'

describe('a runtime\'s archive for a system', () => {
  const spec: RuntimeSpec = {
    id: 'example',
    version: 'v1',
    assets: { 'darwin-arm64': { url: 'https://example.com/a.zip', sha256: '0'.repeat(64), executable: 'a' } }
  }

  it('refuses a system the runtime publishes no archive for, naming those it does', () => {
    expect(assetFor(spec, 'darwin-arm64').executable).toBe('a')
    expect(() => assetFor(spec, 'linux-x64')).toThrow(/example v1 is not measured on linux-x64; it runs on darwin-arm64/)
  })
})

describe('a runtime the bench builds from a pinned commit', () => {
  it('is built on the systems it has a preset for, and refused on the others, naming those it is built on', () => {
    expect(presetFor(NEMO_SPEECH_CPP_SALM, 'darwin-arm64').preset).toBe('metal-server')
    expect(() => presetFor(NEMO_SPEECH_CPP_SALM, 'win32-x64')).toThrow(/builds nemo-speech.cpp 66d50d91b75a on darwin-arm64, not on win32-x64/)
  })

  it('reports the release number NeMo-Speech.cpp prints, with its build metadata, and nothing for another program', () => {
    expect(parseNemoSpeechVersion('nemo-speech 0.2.0\n')).toBe('0.2.0')
    expect(parseNemoSpeechVersion('nemo-speech 0.2.0+nightly.66d50d9')).toBe('0.2.0+nightly.66d50d9')
    expect(parseNemoSpeechVersion('speech.cpp 0.8.8, C API 3.1')).toBeNull()
  })
})
