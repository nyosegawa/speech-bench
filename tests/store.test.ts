import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensurePinned, huggingFaceCacheDir, storePath, type PinnedFile } from '../src/catalog/store.ts'

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

describe('the folder of Hugging Face\'s cache', () => {
  it('is HF_HUB_CACHE, else hub in HF_HOME, else hub in ~/.cache/huggingface, as Hugging Face\'s libraries find it', () => {
    expect(huggingFaceCacheDir({ HF_HUB_CACHE: '/cache/hub', HF_HOME: '/home/hf' })).toBe(path.resolve('/cache/hub'))
    expect(huggingFaceCacheDir({ HF_HOME: '/home/hf' })).toBe(path.join(path.resolve('/home/hf'), 'hub'))
    expect(huggingFaceCacheDir({})).toBe(path.join(os.homedir(), '.cache', 'huggingface', 'hub'))
  })
})

describe('a pinned file that Hugging Face\'s cache holds', () => {
  let root: string
  const pinned = (text: string, file = 'llm_backbone/config.json'): PinnedFile =>
    ({ kind: 'model', repo: 'org/speech-llm', revision: 'ef905575', file, bytes: Buffer.byteLength(text), sha256: sha256(text) })
  const cache = (file: string, text: string): void => {
    const cached = path.join(root, 'hub', 'models--org--speech-llm', 'snapshots', 'ef905575', ...file.split('/'))
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    fs.writeFileSync(cached, text)
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-store-'))
    process.env.SPEECH_BENCH_DATA = path.join(root, 'data')
    process.env.HF_HUB_CACHE = path.join(root, 'hub')
  })
  afterEach(() => {
    delete process.env.SPEECH_BENCH_DATA
    delete process.env.HF_HUB_CACHE
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('is taken from the cache into the store when it has the pinned bytes, at its path in the repository', async () => {
    cache('llm_backbone/config.json', '{"layers":52}')
    const file = pinned('{"layers":52}')
    expect(await ensurePinned(file)).toBe(storePath(file))
    expect(fs.readFileSync(storePath(file), 'utf8')).toBe('{"layers":52}')
  })

  it('stops the run when the cache holds other bytes of the pinned size, rather than downloading it again', async () => {
    cache('llm_backbone/config.json', '{"layers":53}')
    await expect(ensurePinned(pinned('{"layers":52}'))).rejects.toThrow(/sha256 .*, not the pinned/)
    expect(fs.existsSync(storePath(pinned('{"layers":52}')))).toBe(false)
  })
})
