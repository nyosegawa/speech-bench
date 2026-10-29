import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { convertedFiles, convertedPath, convertedSha256, ensureConverted, platform, type Conversion } from '../src/catalog/convert.ts'

describe('the files a conversion writes', () => {
  let data: string
  const conversion = (decoder: Readonly<Record<string, string>>): Conversion => ({
    converter: { id: 'converter', repository: 'https://example.com/converter', commit: 'c0ffee0123456789', script: 'convert.py', submodules: [] },
    checkpoint: { kind: 'model', repo: 'org/model', revision: 'abc', file: 'model.nemo', bytes: 10, sha256: 'checkpoint' },
    args: [],
    outputs: [{ file: 'decoder.gguf', bytes: 5, sha256: decoder }, { file: 'encoder.gguf', bytes: 3, sha256: { [platform()]: 'e'.repeat(64) } }]
  })

  beforeEach(() => {
    data = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-convert-'))
    process.env.SPEECH_BENCH_DATA = data
  })
  afterEach(() => {
    delete process.env.SPEECH_BENCH_DATA
    fs.rmSync(data, { recursive: true, force: true })
  })

  it('are kept together in the folder named by the sha256 this platform pins for the file the converter is told to write', () => {
    const [decoder, encoder] = convertedFiles(conversion({ [platform()]: 'd'.repeat(64) }))
    const folder = path.join(data, 'converted', 'converter-c0ffee012345', 'd'.repeat(16))
    expect(convertedPath(decoder!)).toBe(path.join(folder, 'decoder.gguf'))
    expect(convertedPath(encoder!)).toBe(path.join(folder, 'encoder.gguf'))
    expect(convertedSha256(encoder!)).toBe('e'.repeat(64))
  })

  it('are refused on a platform the file the converter is told to write has no pin for, and a file the conversion does not write is refused', async () => {
    const [, encoder] = convertedFiles(conversion({ 'other-platform': 'd'.repeat(64) }))
    expect(() => convertedPath(encoder!)).toThrow(/decoder.gguf is pinned for other-platform, not for/)
    await expect(ensureConverted({ kind: 'converted', conversion: conversion({ [platform()]: 'd'.repeat(64) }), file: 'other.gguf' })).rejects.toThrow(/other.gguf is not one of the files the conversion of org\/model writes/)
  })

  it('are not made on a disk without the room the conversion needs at its peak, before anything is fetched', async () => {
    const [decoder] = convertedFiles({ ...conversion({ 'other-platform': 'd'.repeat(64) }), room: Number.MAX_SAFE_INTEGER })
    await expect(ensureConverted(decoder!)).rejects.toThrow(/needs \d+ GB free on the disk of .*, and it has \d+ GB/)
  })

  it('count the checkpoint a conversion fetches first in the room it needs', async () => {
    process.env.HF_HUB_CACHE = path.join(data, 'hub')
    try {
      const fetched: Conversion = { ...conversion({ 'other-platform': 'd'.repeat(64) }), room: 1 }
      const [decoder] = convertedFiles({ ...fetched, checkpoint: { ...fetched.checkpoint, bytes: Number.MAX_SAFE_INTEGER - 1 } as Conversion['checkpoint'] })
      await expect(ensureConverted(decoder!)).rejects.toThrow(/needs \d+ GB free on the disk of .*, \d+ GB of it for the checkpoint fetched first, and it has \d+ GB/)
    } finally {
      delete process.env.HF_HUB_CACHE
    }
  })
})
