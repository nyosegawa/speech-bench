import { describe, expect, it } from 'vitest'
import { assetFor, type RuntimeSpec } from '../src/catalog/runtimes.ts'

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
