import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { coldCopies, commonFolder } from '../src/catalog/cold-copy.ts'

describe('the folder model files share', () => {
  it('is the deepest folder that holds every file', () => {
    const root = path.resolve('/data/models/repo/rev')
    expect(commonFolder([path.join(root, 'config.json'), path.join(root, 'speech_tokenizer', 'model.safetensors')])).toBe(root)
    expect(commonFolder([path.join(root, 'model.gguf')])).toBe(root)
  })
})

describe('cold copies of model files', () => {
  let data: string
  beforeEach(() => {
    data = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-test-'))
    process.env.SPEECH_BENCH_DATA = data
  })
  afterEach(() => {
    delete process.env.SPEECH_BENCH_DATA
    fs.rmSync(data, { recursive: true, force: true })
  })

  // Linux makes no cold copy: an uncached copy there needs root.
  it.skipIf(process.platform === 'linux')('keeps each file\'s place below the folder they share, with its contents, and removes the copies', () => {
    const model = path.join(data, 'models', 'repo', 'rev')
    fs.mkdirSync(path.join(model, 'speech_tokenizer'), { recursive: true })
    fs.writeFileSync(path.join(model, 'config.json'), '{"a":1}')
    fs.writeFileSync(path.join(model, 'speech_tokenizer', 'model.safetensors'), Buffer.alloc(4096, 7))
    const copies = coldCopies([path.join(model, 'config.json'), path.join(model, 'speech_tokenizer', 'model.safetensors')])
    const [config, tokenizer] = copies.files
    expect(path.dirname(tokenizer!)).toBe(path.join(path.dirname(config!), 'speech_tokenizer'))
    expect(fs.readFileSync(config!, 'utf8')).toBe('{"a":1}')
    expect(fs.readFileSync(tokenizer!)).toEqual(Buffer.alloc(4096, 7))
    copies.remove()
    expect(fs.existsSync(config!)).toBe(false)
  })
})
