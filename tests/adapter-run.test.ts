import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ASR_MODELS, TTS_MODELS, ttsModel, type TtsModel } from '../src/catalog/models.ts'
import { storePath, type PinnedFile } from '../src/catalog/store.ts'
import type { ReferenceVoice } from '../src/make/references.ts'
import { adapterRun } from '../src/measure/run-tts.ts'

type AdapterModel = Extract<TtsModel, { runtime: 'adapter' }>

const synthesisAdapters = TTS_MODELS.filter((model): model is AdapterModel => model.runtime === 'adapter')
const checkpoints = [...synthesisAdapters, ...ASR_MODELS.filter((model) => model.runtime === 'adapter')]

const reference: ReferenceVoice = {
  name: 'announcer',
  file: path.join(path.sep, 'references', 'announcer.wav'),
  sha256: 'a'.repeat(64),
  seconds: 12.8,
  transcript: '札幌の今日の最高気温は十八度、湿度は五十パーセントの予想です。 本日の予定は三件です。'
}

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const realArch = Object.getOwnPropertyDescriptor(process, 'arch')!
afterEach(() => {
  Object.defineProperty(process, 'platform', realPlatform)
  Object.defineProperty(process, 'arch', realArch)
})

/** Makes the bench see the one system the model's adapter runs on: mlx-audio a Mac, the others Linux with CUDA. */
function onItsSystem(model: AdapterModel): void {
  const [platform, arch] = model.adapter === 'mlx-audio' ? ['darwin', 'arm64'] : ['linux', 'x64']
  Object.defineProperty(process, 'platform', { ...realPlatform, value: platform })
  Object.defineProperty(process, 'arch', { ...realArch, value: arch })
}

/** The path the store keeps an entry's file at, which the bench gives the adapter. */
function fileOf(model: { id: string; files: readonly unknown[] }): (name: string) => string {
  return (name) => {
    const file = (model.files as readonly PinnedFile[]).find((candidate) => candidate.file === name)
    if (!file) throw new Error(`${model.id} has no file ${name}`)
    return storePath(file)
  }
}

/** The adapter's arguments for a run of the model, with the reference voice when the model takes one. */
const runOf = (model: AdapterModel): ReturnType<typeof adapterRun> => {
  onItsSystem(model)
  return adapterRun(model, fileOf(model), model.voiceReference ? reference : null)
}

interface Flag {
  required: boolean
  repeated: boolean
  choices: string[] | null
}

/** The flags an adapter's worker declares to argparse, each of which takes a value. */
function workerFlags(adapter: string): Map<string, Flag> {
  const script = fs.readFileSync(path.join(import.meta.dirname, '..', 'adapters', adapter, 'worker.py'), 'utf8')
  return new Map([...script.matchAll(/add_argument\("(--[a-z-]+)"([^\n]*)\)/g)].map(([, name, rest]) => {
    const choices = /choices=\[([^\]]*)\]/.exec(rest!)
    return [name!, {
      required: rest!.includes('required=True'),
      repeated: rest!.includes('action="append"'),
      choices: choices ? choices[1]!.split(',').map((choice) => choice.trim().replace(/^"|"$/g, '')) : null
    }]
  }))
}

/** The arguments as pairs of a flag and its value. */
function flagPairs(args: readonly string[]): Array<[string, string]> {
  expect(args.length % 2).toBe(0)
  return Array.from({ length: args.length / 2 }, (_, index) => {
    const [flag, value] = [args[index * 2]!, args[index * 2 + 1]!]
    expect(flag).toMatch(/^--/)
    expect(value).not.toMatch(/^--/)
    return [flag, value]
  })
}

describe('adapterRun', () => {
  it.each(synthesisAdapters.map((model) => [model.id, model] as const))('starts %s\'s worker with the flags it declares, each required one once, and values it accepts', (_, model) => {
    const pairs = flagPairs(runOf(model).args)
    const flags = workerFlags(model.adapter)
    for (const [name, value] of pairs) {
      const flag = flags.get(name)
      expect(flag, `${name} is not a flag of the ${model.adapter} worker`).toBeDefined()
      if (flag!.choices) expect(flag!.choices).toContain(value)
    }
    for (const [name, flag] of flags) {
      const given = pairs.filter(([candidate]) => candidate === name).length
      if (flag.required) expect(given, name).toBe(1)
      if (!flag.repeated) expect(given, name).toBeLessThanOrEqual(1)
    }
  })

  it.each(synthesisAdapters.filter((model) => workerFlags(model.adapter).has('--voice-text')).map((model) => [model.id, model] as const))(
    'gives %s\'s worker the reference voice with its transcript, which the worker refuses a voice without',
    (_, model) => {
      const pairs = flagPairs(runOf(model).args)
      const voices = pairs.filter(([flag]) => flag === '--add-voice').map(([, value]) => value.split('=')[0])
      const texts = new Map(pairs.filter(([flag]) => flag === '--voice-text').map(([, value]) => [value.slice(0, value.indexOf('=')), value.slice(value.indexOf('=') + 1)]))
      expect(voices).toHaveLength(1)
      expect(texts.get(voices[0]!)).toBe(reference.transcript)
    }
  )

  it.each(synthesisAdapters.filter((model) => workerFlags(model.adapter).has('--temperature')).map((model) => [model.id, model] as const))(
    'records the sampling %s\'s worker is given',
    (_, model) => {
      const { args, loadOptions } = runOf(model)
      const sent = new Map(flagPairs(args))
      for (const [flag, option] of [['--temperature', 'temperature'], ['--top-p', 'top_p'], ['--top-k', 'top_k']] as const) {
        if (sent.has(flag)) expect(loadOptions[option], option).toBe(sent.get(flag))
      }
    }
  )

  it('records SGLang Omni\'s official checkpoint as the official implementation computes it, and the int4 one with its int4 weights', () => {
    const precision = (id: string): Record<string, string | undefined> => {
      const { loadOptions } = runOf(ttsModel(id) as AdapterModel)
      return { precision: loadOptions.precision, experts: loadOptions.experts, attention: loadOptions.attention }
    }
    expect(precision('drama-3-sglang')).toEqual(precision('drama-3-official'))
    expect(precision('drama-3-int4-sglang')).toEqual({ precision: 'bf16', experts: 'int4', attention: 'int4' })
  })
})

describe('the checkpoints the adapters run', () => {
  it.each(checkpoints.map((model) => [model.id, model] as const))('pin every file of %s by a full revision, its size and its sha256', (_, model) => {
    for (const file of model.files as PinnedFile[]) {
      expect(file.kind, file.file).toBe('model')
      expect(file.revision, file.file).toMatch(/^[0-9a-f]{40}$/)
      expect(file.sha256, file.file).toMatch(/^[0-9a-f]{64}$/)
      expect(Number.isSafeInteger(file.bytes) && file.bytes > 0, file.file).toBe(true)
    }
  })

  it.each(checkpoints.map((model) => [model.id, model] as const))('hold every shard of %s\'s weights with their index', (_, model) => {
    const names = (model.files as readonly PinnedFile[]).map((file) => file.file)
    const shards = names.filter((name) => /^model-\d{5}-of-\d{5}\.safetensors$/.test(name)).sort()
    if (shards.length === 0) return
    const count = Number(/-of-(\d{5})\./.exec(shards[0]!)![1])
    const digits = (value: number): string => String(value).padStart(5, '0')
    expect(shards).toEqual(Array.from({ length: count }, (_, index) => `model-${digits(index + 1)}-of-${digits(count)}.safetensors`))
    expect(names).toContain('model.safetensors.index.json')
  })

  it.each(synthesisAdapters.map((model) => [model.id, model] as const))('keep every file of %s in the folder its worker is given, where it has one', (_, model) => {
    const paths = new Set((model.files as readonly PinnedFile[]).map((file) => storePath(file)))
    const folders = flagPairs(runOf(model).args).filter(([flag, value]) => (flag === '--checkpoint' || flag === '--model') && !paths.has(value)).map(([, value]) => value)
    for (const folder of folders) {
      for (const file of paths) expect(file.startsWith(folder + path.sep), file).toBe(true)
    }
  })
})
