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

  it('reads the pin of a dependency installed with extras', () => {
    expect(pinnedVersion(project('sglang-omni[fishaudio] @ git+https://github.com/sgl-project/sglang-omni@549dd1b9e84d834a4d49a7c91d496db454859e80'), 'sglang-omni')).toBe('549dd1b9e84d')
    expect(pinnedVersion(project('qwen-asr[vllm]==0.0.6'), 'qwen-asr')).toBe('qwen-asr==0.0.6')
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

  it.each(fs.readdirSync(adapters))('%s installs a CUDA build of PyTorch on each system with an NVIDIA GPU it runs on, and PyPI\'s on a Mac, if it runs PyTorch', (id) => {
    const project = read(id, 'pyproject.toml')
    const lock = read(id, 'uv.lock')
    const wheels = lockedWheels(lock, 'torch')
    if (!/^\s*"torch==/m.test(project)) {
      expect(wheels).toEqual([])
      return
    }
    const runsOn = (system: string): boolean => project.includes(`sys_platform == '${system}'`)
    // PyPI's PyTorch for Windows runs on the CPU alone, so the CUDA build comes from PyTorch's own index.
    const windows = wheels.filter((url) => url.endsWith('win_amd64.whl'))
    expect(windows.length > 0).toBe(runsOn('win32'))
    for (const url of windows) expect(url).toMatch(/^https:\/\/download(-r2)?\.pytorch\.org\/whl\/cu\d+\/torch-[^/]+%2Bcu\d+-/)
    expect(wheels.some((url) => url.startsWith('https://files.pythonhosted.org/') && url.endsWith('macosx_11_0_arm64.whl'))).toBe(runsOn('darwin'))
    // PyPI's PyTorch for Linux x64 is a CUDA build, which pulls in NVIDIA's CUDA runtime: for CUDA 12 a package named
    // with the major version, for CUDA 13 one without it.
    const linux = wheels.filter((url) => url.startsWith('https://files.pythonhosted.org/') && url.endsWith('manylinux_2_28_x86_64.whl'))
    expect(linux.length > 0).toBe(runsOn('linux'))
    if (runsOn('linux')) expect(lock).toMatch(/\{ name = "nvidia-cuda-runtime(-cu12)?", marker = "[^"]*sys_platform == 'linux'[^"]*" \}/)
  })
})
