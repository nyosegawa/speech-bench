import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ASR_MODELS, TTS_MODELS, ttsModel, type AsrModel, type TtsModel } from '../src/catalog/models.ts'
import { storePath, type PinnedFile } from '../src/catalog/store.ts'
import type { ReferenceVoice } from '../src/make/references.ts'
import { adapterScript } from '../src/engines/adapter.ts'
import { adapterAsr } from '../src/measure/run-asr.ts'
import { adapterRun } from '../src/measure/run-tts.ts'

type AdapterModel = Extract<TtsModel, { runtime: 'adapter' }>
type RecognitionAdapterModel = Extract<AsrModel, { runtime: 'adapter' }>

const synthesisAdapters = TTS_MODELS.filter((model): model is AdapterModel => model.runtime === 'adapter')
const recognitionAdapters = ASR_MODELS.filter((model): model is RecognitionAdapterModel => model.runtime === 'adapter')
const checkpoints = [...synthesisAdapters, ...recognitionAdapters]

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
function onItsSystem(model: AdapterModel | RecognitionAdapterModel): void {
  const [platform, arch] = model.adapter === 'mlx-audio' || model.adapter === 'mlx-audio-asr' ? ['darwin', 'arm64'] : ['linux', 'x64']
  Object.defineProperty(process, 'platform', { ...realPlatform, value: platform })
  Object.defineProperty(process, 'arch', { ...realArch, value: arch })
}

/** The adapter's arguments for a recognition run of the model, given the paths the store keeps its files at. */
const recognitionRunOf = (model: RecognitionAdapterModel): ReturnType<typeof adapterAsr> => {
  onItsSystem(model)
  return adapterAsr(model, (model.files as readonly PinnedFile[]).map((file) => storePath(file)))
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

/** The worker of a synthesis adapter, which each keeps in its own folder. */
const scriptOf = (adapter: string): string => path.join(import.meta.dirname, '..', 'adapters', adapter, 'worker.py')

interface Flag {
  required: boolean
  repeated: boolean
  choices: string[] | null
}

/**
 * The flags an adapter's worker declares to argparse, each of which takes a value. Choices are a list written out or
 * the sorted keys of a dictionary of the script, `choices=sorted(NAME)`, a literal of quoted keys without nested braces.
 */
function workerFlags(file: string): Map<string, Flag> {
  const script = fs.readFileSync(file, 'utf8')
  const keysOf = (name: string): string[] => {
    const table = new RegExp(`^${name} = \\{([^}]*)\\}`, 'm').exec(script)
    if (!table) throw new Error(`${file} has no dictionary ${name}`)
    return [...table[1]!.matchAll(/"([^"]+)":/g)].map((match) => match[1]!)
  }
  return new Map([...script.matchAll(/add_argument\("(--[a-z-]+)"([^\n]*)\)/g)].map(([, name, rest]) => {
    const listed = /choices=\[([^\]]*)\]/.exec(rest!)
    const keyed = /choices=sorted\(([A-Z_]+)\)/.exec(rest!)
    return [name!, {
      required: rest!.includes('required=True'),
      repeated: rest!.includes('action="append"'),
      choices: listed ? listed[1]!.split(',').map((choice) => choice.trim().replace(/^"|"$/g, '')) : keyed ? keysOf(keyed[1]!) : null
    }]
  }))
}

/** Expects the arguments to give the worker only flags it declares, each required one once, and values it accepts. */
function expectDeclared(args: readonly string[], file: string): void {
  const pairs = flagPairs(args)
  const flags = workerFlags(file)
  for (const [name, value] of pairs) {
    const flag = flags.get(name)
    expect(flag, `${name} is not a flag of ${file}`).toBeDefined()
    if (flag!.choices) expect(flag!.choices).toContain(value)
  }
  for (const [name, flag] of flags) {
    const given = pairs.filter(([candidate]) => candidate === name).length
    if (flag.required) expect(given, name).toBe(1)
    if (!flag.repeated) expect(given, name).toBeLessThanOrEqual(1)
  }
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
    expectDeclared(runOf(model).args, scriptOf(model.adapter))
  })

  it.each(synthesisAdapters.filter((model) => workerFlags(scriptOf(model.adapter)).has('--voice-text')).map((model) => [model.id, model] as const))(
    'gives %s\'s worker the reference voice with its transcript, which the worker refuses a voice without',
    (_, model) => {
      const pairs = flagPairs(runOf(model).args)
      const voices = pairs.filter(([flag]) => flag === '--add-voice').map(([, value]) => value.split('=')[0])
      const texts = new Map(pairs.filter(([flag]) => flag === '--voice-text').map(([, value]) => [value.slice(0, value.indexOf('=')), value.slice(value.indexOf('=') + 1)]))
      expect(voices).toHaveLength(1)
      expect(texts.get(voices[0]!)).toBe(reference.transcript)
    }
  )

  it.each(synthesisAdapters.filter((model) => workerFlags(scriptOf(model.adapter)).has('--temperature')).map((model) => [model.id, model] as const))(
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

  it.each(checkpoints.map((model) => [model.id, model] as const))('keep every file of %s in the folder its worker is given, where it has one', (_, model) => {
    const paths = new Set((model.files as readonly PinnedFile[]).map((file) => storePath(file)))
    const recognition = recognitionAdapters.find((candidate) => candidate === model)
    const { args } = recognition ? recognitionRunOf(recognition) : runOf(model as AdapterModel)
    const folders = flagPairs(args).filter(([flag, value]) => (flag === '--checkpoint' || flag === '--model') && !paths.has(value)).map(([, value]) => value)
    for (const folder of folders) {
      for (const file of paths) expect(file.startsWith(folder + path.sep), file).toBe(true)
    }
  })
})

describe('adapterAsr', () => {
  it.each(recognitionAdapters.map((model) => [model.id, model] as const))('starts %s\'s worker with the flags it declares, each required one once, and values it accepts', (_, model) => {
    const { adapter, args } = recognitionRunOf(model)
    expectDeclared(args, adapterScript(adapter))
  })

  it.each(recognitionAdapters.map((model) => [model.id, model] as const))('records what %s\'s worker is told besides the audio', (_, model) => {
    const { args, loadOptions } = recognitionRunOf(model)
    const sent = new Map(flagPairs(args))
    expect(loadOptions.instruction).toBe(sent.get('--instruction'))
    expect(loadOptions.seed).toBe(sent.get('--seed'))
    if (sent.has('--dtype')) expect(loadOptions.precision).toBe(sent.get('--dtype'))
  })

  it('tells Granite Speech the language through the placeholder its worker fills', () => {
    const granite = recognitionAdapters.filter((model) => model.adapter === 'transformers-asr' && model.recipe === 'granite-speech')
    expect(granite.length).toBeGreaterThan(0)
    for (const model of granite) expect(new Map(flagPairs(recognitionRunOf(model).args)).get('--instruction')).toContain('<language>')
  })
})
