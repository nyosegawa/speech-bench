import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pinnedVersion } from '../src/engines/adapter.ts'

describe('pinnedVersion', () => {
  const project = (dependency: string): string => `[project]\ndependencies = [\n  "${dependency}",\n  "numpy",\n]\n`

  it('names a git dependency by its commit, shortened, and a release by the package and its version', () => {
    expect(pinnedVersion(project('qwen-tts @ git+https://github.com/QwenLM/Qwen3-TTS@022e286b98fbec7e1e916cb940cdf532cd9f488e'), 'qwen-tts')).toBe('022e286b98fb')
    expect(pinnedVersion(project('transformers==5.18.0'), 'transformers')).toBe('transformers==5.18.0')
  })

  it('refuses an implementation not pinned to one commit or release, whose version a result could not name', () => {
    expect(() => pinnedVersion(project('transformers>=5.18'), 'transformers')).toThrow(/does not pin transformers/)
    expect(() => pinnedVersion(project('qwen-tts @ git+https://github.com/QwenLM/Qwen3-TTS@main'), 'qwen-tts')).toThrow(/does not pin qwen-tts/)
    expect(() => pinnedVersion(project('qwen-tts-extras==1.0'), 'qwen-tts')).toThrow(/does not pin qwen-tts/)
  })
})

/**
 * The wheels of a package that a uv.lock pins, by the URL each is downloaded from. The lock is read by its lines, which
 * a Windows checkout may end with CRLF.
 */
function lockedWheels(lock: string, name: string): string[] {
  return lock.split('[[package]]').filter((block) => new RegExp(`^name = "${name}"\\r?$`, 'm').test(block)).flatMap((block) => [...block.matchAll(/url = "([^"]+\.whl)"/g)].map((match) => match[1]!))
}

describe('the adapters\' environments', () => {
  const adapters = path.join(import.meta.dirname, '..', 'adapters')
  const read = (id: string, file: string): string => fs.readFileSync(path.join(adapters, id, file), 'utf8')

  it.each(fs.readdirSync(adapters))('%s installs PyTorch\'s CUDA build on Windows, where PyPI\'s runs on the CPU alone, and PyPI\'s on a Mac, if it runs PyTorch', (id) => {
    const wheels = lockedWheels(read(id, 'uv.lock'), 'torch')
    if (!/^\s*"torch==/m.test(read(id, 'pyproject.toml'))) {
      expect(wheels).toEqual([])
      return
    }
    const windows = wheels.filter((url) => url.endsWith('win_amd64.whl'))
    expect(windows.length).toBeGreaterThan(0)
    for (const url of windows) expect(url).toMatch(/^https:\/\/download(-r2)?\.pytorch\.org\/whl\/cu\d+\/torch-[^/]+%2Bcu\d+-/)
    expect(wheels.some((url) => url.startsWith('https://files.pythonhosted.org/') && url.endsWith('macosx_11_0_arm64.whl'))).toBe(true)
  })
})
