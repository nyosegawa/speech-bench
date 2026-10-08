import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureLocalFile, localFile, withLocalFile } from '../src/catalog/local-file.ts'
import { asrModel, ttsModel } from '../src/catalog/models.ts'
import { modelsNamed } from '../src/cli/measure.ts'
import { latestRuns, type ListenedRun } from '../src/pages/listen.ts'
import { modelRecord } from '../src/measure/run-asr.ts'
import { ttsRun } from './run-records.ts'

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

describe('a local model file', () => {
  let folder: string
  let file: string

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-bench-local-'))
    file = path.join(folder, 'Qwen3-ASR-1.7B-Q6_K.gguf')
    fs.writeFileSync(file, 'weights')
  })
  afterEach(() => {
    fs.rmSync(folder, { recursive: true, force: true })
  })

  it('is used when it has the sha256 it is named by, given in either case', async () => {
    const local = localFile(file, sha256('weights').toUpperCase())
    expect(local).toEqual({ kind: 'local', path: file, file: 'Qwen3-ASR-1.7B-Q6_K.gguf', bytes: 7, sha256: sha256('weights') })
    expect(await ensureLocalFile(local)).toBe(file)
  })

  it('is refused once its bytes are no longer the ones its sha256 names, whatever its size', async () => {
    const local = localFile(file, sha256('weights'))
    fs.writeFileSync(file, 'WEIGHTS')
    await expect(ensureLocalFile(local)).rejects.toThrow(/sha256/)
    fs.writeFileSync(file, 'other weights')
    await expect(ensureLocalFile(local)).rejects.toThrow(/bytes/)
  })

  it('is refused when it is named by something that is not a sha256, or is not there', () => {
    expect(() => localFile(file, sha256('weights').slice(0, 12))).toThrow(/not a sha256/)
    expect(() => localFile(path.join(folder, 'missing.gguf'), sha256('weights'))).toThrow(/not a file/)
  })

  it('takes the place of an entry\'s one file under an id and label of its own, keeping how the entry runs', () => {
    const entry = asrModel('reazonspeech-nemo-v2-greedy-speech.cpp')
    const local = withLocalFile(entry, localFile(file, sha256('weights')))
    expect(local.id).not.toBe(entry.id)
    expect(local.label).not.toBe(entry.label)
    expect(local.label).toContain('Qwen3-ASR-1.7B-Q6_K.gguf')
    expect({ ...local, id: entry.id, label: entry.label, files: entry.files }).toEqual(entry)
    expect(modelRecord(local).files).toEqual([{ source: 'local', file: 'Qwen3-ASR-1.7B-Q6_K.gguf', bytes: 7, sha256: sha256('weights') }])
  })

  it('keeps the runs of two local files and of the published file apart on the listening page', () => {
    const entry = ttsModel('irodori-tts-v4.1-small-16steps')
    const other = path.join(folder, 'Irodori-TTS-859M-v4.1-Q5_K.gguf')
    fs.writeFileSync(other, 'other weights')
    const models = [entry, withLocalFile(entry, localFile(file, sha256('weights'))), withLocalFile(entry, localFile(other, sha256('other weights')))]
    const runs = models.map((model) => ({ run: ttsRun({ model: modelRecord(model) }) }) as ListenedRun)
    expect(latestRuns(runs)).toHaveLength(3)
  })

  it('is refused for an entry of more than one file, and named for one model only, always with its sha256', () => {
    expect(() => withLocalFile(asrModel('qwen3-asr-1.7b'), localFile(file, sha256('weights')))).toThrow(/2 files/)
    expect(() => modelsNamed('qwen3-asr-1.7b-speech.cpp', asrModel, file, undefined)).toThrow(/--model-sha256/)
    expect(() => modelsNamed('qwen3-asr-1.7b-speech.cpp,qwen3-asr-0.6b-speech.cpp', asrModel, file, sha256('weights'))).toThrow(/one model/)
    expect(modelsNamed('qwen3-asr-1.7b-speech.cpp', asrModel, file, sha256('weights')).map((model) => model.files)).toEqual([[localFile(file, sha256('weights'))]])
  })
})
