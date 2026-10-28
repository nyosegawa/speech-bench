import fs from 'node:fs'
import path from 'node:path'
import { modelCovers, VAD_MODEL, type AsrModel } from '../catalog/models.ts'
import type { UtteranceSet } from '../datasets/item.ts'
import { coldCopies } from '../catalog/cold-copy.ts'
import { ensureModelFile, type ModelFile } from '../catalog/model-file.ts'
import { checkpointOrigin, convertedSha256 } from '../catalog/convert.ts'
import { CrispAsr } from '../engines/crispasr.ts'
import type { AsrEngine } from '../engines/engine.ts'
import { LlamaServerAsr } from '../engines/llama-server.ts'
import { NEMO_SPEECH_LOAD_OPTIONS, NEMO_SPEECH_SALM_LOAD_OPTIONS, nemoSpeechDevice, NemoSpeechAsr, NemoSpeechSalmAsr } from '../engines/nemo-speech.ts'
import { speechWorkerArgs } from '../engines/worker.ts'
import { WorkerAsr } from '../engines/worker-asr.ts'
import { VoiceDetector } from '../engines/voice-activity.ts'
import { gpuDevice, machineInfo, platformKey, torchDevice } from '../core/platform.ts'
import { adapterCommand, adapterVersion, MLX_AUDIO_ASR_ADAPTER, QWEN3_ASR_ADAPTER, syncAdapter } from '../engines/adapter.ts'
import { RESULT_FORMAT, type AsrRunRecord, type ModelRecord, type NewPreparation, type UtteranceRecord } from './result-file/format.ts'
import { RuntimeWatch } from './watch.ts'
import { resultText } from './result-file/file.ts'
import { runFile } from './runs.ts'
import { CRISPASR, ensureNemoSpeechSalm, ensureRuntime, ensureSpeechCpp, LLAMA_CPP, NEMO_SPEECH_CPP, releaseOf, type RuntimeIdentity } from '../catalog/runtimes.ts'
import { durationSeconds, peakNormalize, readWav, trimAround, withTrailingSilence, type Pcm } from '../core/wav.ts'

/** How utterances are prepared unless a run asks otherwise. */
export const TRIM_TO_VOICE: Extract<NewPreparation, { edges: 'voice' }> = { edges: 'voice', detector: VAD_MODEL.id, marginSeconds: 0.2 }

/**
 * The audio a model hears: trimmed to the voice the detector finds with the margin around it and scaled to a
 * peak of 0.9, or as recorded with silence after it. Null when the detector finds no voice, so that no model
 * hears the utterance.
 */
export function prepareAudio(pcm: Pcm, preparation: NewPreparation, detector: Pick<VoiceDetector, 'voiceSpan'> | null): Pcm | null {
  if (preparation.edges === 'as-recorded') return withTrailingSilence(pcm, preparation.trailingSilence)
  if (!detector) throw new Error('trimming to the voice needs a voice detector')
  const span = detector.voiceSpan(pcm)
  return span && peakNormalize(trimAround(pcm, span.start, span.end, preparation.marginSeconds))
}

/** The local paths of a model's files, in the order the catalog lists them, after fetching or converting whatever is missing. */
export async function modelFiles(model: { files: readonly ModelFile[] }): Promise<string[]> {
  const files: string[] = []
  for (const file of model.files) files.push(await ensureModelFile(file))
  return files
}

/** How a run is made beyond its model and its set. */
export interface RunSetup {
  /** Whether the runtime loads the model from copies no file cache holds, for a cold load time. */
  coldLoad: boolean
  /**
   * The build of speech.cpp a speech.cpp entry runs, as `ensureSpeechCpp` takes it: a pinned release's tag, a local
   * build directory or `ci:<run id>`; null for the one SPEECH_BENCH_SPEECH_CPP names or the pinned release.
   */
  speechCpp: string | null
  /**
   * The device in ggml's names that a runtime built on ggml is told to use, such as CPU, which the run records among
   * its options; null for the GPU (SPEECH_BENCH_DEVICE), which a run does not record.
   */
  device: string | null
  /** The combination of a measurement plan the run is made for and its round, or null for a run made by hand. */
  plan: { combination: string; round: number } | null
}

export const DEFAULT_SETUP: RunSetup = { coldLoad: false, speechCpp: null, device: null, plan: null }

/** The device a runtime built on ggml is told to use, and the options a run records of it. */
export const deviceOf = (setup: RunSetup): { device: string; options: Record<string, string> } =>
  setup.device === null ? { device: gpuDevice(), options: {} } : { device: setup.device, options: { device: setup.device } }

/** Refuses what a runtime that does not run on ggml or is not speech.cpp cannot be given. */
export function checkSetupFor(model: { id: string; runtime: string }, setup: RunSetup): void {
  if (setup.speechCpp !== null && model.runtime !== 'speech.cpp') throw new Error(`${model.id} runs in ${model.runtime}, not in a build of speech.cpp`)
  if (setup.device !== null && !['speech.cpp', 'llama-server', 'nemo-speech.cpp'].includes(model.runtime)) throw new Error(`${model.id} runs in ${model.runtime}, which the bench gives no device`)
}

/**
 * The model's files as the run reads them, copies that no file cache holds for a cold load, and how to remove those
 * copies once the runtime has stopped.
 */
export async function filesFor(model: { files: readonly ModelFile[] }, setup: RunSetup): Promise<{ files: string[]; remove: () => void }> {
  const files = await modelFiles(model)
  return setup.coldLoad ? coldCopies(files) : { files, remove: () => undefined }
}

/**
 * What a run records of how a speech-LLM is asked: the instruction every utterance is sent with, greedy decoding and
 * no reasoning, which both of its runtimes do by default and the run states, since the model's card gives other
 * settings for other tasks.
 */
export const speechLmOptions = (instruction: string): Record<string, string> => ({ instruction, temperature: '0', reasoning: 'off' })

/** The engine that runs the model from `files`, the local paths of its files, with its runtime and the options it is loaded with. */
export async function prepareAsr(model: AsrModel, files: readonly string[], setup: RunSetup): Promise<{ engine: AsrEngine; runtime: RuntimeIdentity; loadOptions: Readonly<Record<string, string>> }> {
  checkSetupFor(model, setup)
  const { device, options } = deviceOf(setup)
  if (model.runtime === 'llama-server') {
    return { engine: new LlamaServerAsr(await ensureRuntime(LLAMA_CPP), model, files, device), runtime: releaseOf(LLAMA_CPP), loadOptions: options }
  }
  if (model.runtime === 'adapter') {
    const folder = path.dirname(files[model.files.findIndex((file) => file.file === 'config.json')]!)
    if (model.adapter === 'mlx-audio-asr') {
      if (platformKey() !== 'darwin-arm64') throw new Error('mlx-audio runs on Apple silicon alone')
      syncAdapter(MLX_AUDIO_ASR_ADAPTER)
      const engine = new WorkerAsr(adapterCommand(MLX_AUDIO_ASR_ADAPTER, model.id, ['--model', folder, '--instruction', model.instruction]), { ...model, decoding: null })
      return { engine, runtime: releaseOf({ id: MLX_AUDIO_ASR_ADAPTER.id, version: adapterVersion(MLX_AUDIO_ASR_ADAPTER) }), loadOptions: { device: 'metal', precision: '4bit', ...speechLmOptions(model.instruction) } }
    }
    const device = torchDevice()
    syncAdapter(QWEN3_ASR_ADAPTER)
    const engine = new WorkerAsr(adapterCommand(QWEN3_ASR_ADAPTER, model.id, ['--model', folder, '--device', device]), { ...model, decoding: null })
    return { engine, runtime: releaseOf({ id: QWEN3_ASR_ADAPTER.id, version: adapterVersion(QWEN3_ASR_ADAPTER) }), loadOptions: { device, precision: 'bf16' } }
  }
  if (model.runtime === 'nemo-speech.cpp' && model.family === 'salm') {
    // The decoder names its encoder file, which the server loads from the decoder's folder, where the conversion put it.
    const decoder = files[0]
    if (!decoder) throw new Error(`${model.id} has no decoder`)
    const { executable, runtime } = ensureNemoSpeechSalm()
    const engine = new NemoSpeechSalmAsr(executable, model, decoder, nemoSpeechDevice(device))
    return { engine, runtime, loadOptions: { ...NEMO_SPEECH_SALM_LOAD_OPTIONS, ...options, ...speechLmOptions(model.instruction) } }
  }
  const [gguf] = files
  if (!gguf || files.length !== 1) throw new Error(`${model.id} is one GGUF file in ${model.runtime}`)
  if (model.runtime === 'speech.cpp') {
    const { executable, runtime } = await ensureSpeechCpp(setup.speechCpp)
    return { engine: new WorkerAsr({ name: model.id, executable, args: speechWorkerArgs(gguf, device, null) }, model), runtime, loadOptions: options }
  }
  if (model.runtime === 'nemo-speech.cpp') {
    const engine = new NemoSpeechAsr(await ensureRuntime(NEMO_SPEECH_CPP), model, gguf, nemoSpeechDevice(device))
    return { engine, runtime: releaseOf(NEMO_SPEECH_CPP), loadOptions: { ...NEMO_SPEECH_LOAD_OPTIONS, ...options } }
  }
  return { engine: new CrispAsr(await ensureRuntime(CRISPASR), model, gguf), runtime: releaseOf(CRISPASR), loadOptions: {} }
}

/**
 * A model's files as a result records them: the repository and revision of a download, or of the checkpoint a
 * converted file was made from with the converter that made it, or the name and size of a local file, and the sha256
 * of the file the runtime loaded.
 */
function fileRecord(file: ModelFile): ModelRecord['files'][number] {
  if (file.kind === 'local') return { source: 'local', file: file.file, bytes: file.bytes, sha256: file.sha256 }
  if (file.kind === 'converted') {
    const { checkpoint, converter, args } = file.conversion
    return { source: 'huggingface', ...checkpointOrigin(checkpoint), file: file.file, sha256: convertedSha256(file), converter: { repository: converter.repository, commit: converter.commit, args: [...args] } }
  }
  return { source: 'huggingface', repo: file.repo, revision: file.revision, file: file.file, sha256: file.sha256, converter: null }
}

/** The model as a result records it. */
export const modelRecord = (model: { id: string; label: string; license: string; files: readonly ModelFile[] }): ModelRecord =>
  ({ id: model.id, label: model.label, license: model.license, files: model.files.map(fileRecord) })

const stamp = (date: Date): string => date.toISOString().replace(/[:.]/g, '-')

/**
 * Transcribes every utterance of the set with the model and writes one JSON line per utterance, so that
 * a run cut short still leaves what it measured; what was watched while the runtime ran, its memory among it, is
 * written into the run line once the runtime has stopped. Returns the path of the result file.
 */
export async function runAsr(model: AsrModel, set: UtteranceSet, audio: NewPreparation, setup: RunSetup = DEFAULT_SETUP): Promise<string> {
  if (!modelCovers(model, set.locale)) throw new Error(`${model.id} does not list ${set.locale} among its languages`)
  if (set.utterances.length === 0) throw new Error(`${set.name} has no utterances`)
  checkSetupFor(model, setup)
  const read = await filesFor(model, setup)
  try {
    return await transcribeSet(model, set, audio, setup, read.files)
  } finally {
    read.remove()
  }
}

/** Runs the model from `files` over the set and writes the result file, whose path it returns. */
async function transcribeSet(model: AsrModel, set: UtteranceSet, audio: NewPreparation, setup: RunSetup, files: readonly string[]): Promise<string> {
  const { engine, runtime, loadOptions } = await prepareAsr(model, files, setup)
  const detector = audio.edges === 'voice' ? await VoiceDetector.open(VAD_MODEL) : null
  const startedAt = new Date()
  const machine = machineInfo()
  const watch = await RuntimeWatch.start(machine, () => engine.pid)
  const loadStarted = performance.now()
  try {
    await engine.start()
    const loadSeconds = (performance.now() - loadStarted) / 1000
    const load = (file: string): Pcm | null => prepareAudio(readWav(fs.readFileSync(file)), audio, detector)
    let warmup: Pcm | null = null
    for (const utterance of set.utterances) {
      warmup = load(utterance.audio)
      if (warmup) break
    }
    if (!warmup) throw new Error(`the voice detector finds no voice in any utterance of ${set.name}; there is nothing to transcribe`)
    const warmupSeconds = (await engine.transcribe(warmup, set.locale)).seconds
    const file = runFile(`asr-${stamp(startedAt)}-${machine.hostname}-${model.id}-${set.name}`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const run: AsrRunRecord = {
      type: 'run',
      format: RESULT_FORMAT,
      task: 'asr',
      startedAt: startedAt.toISOString(),
      machine,
      set: { name: set.name, locale: set.locale, size: set.utterances.length },
      model: modelRecord(model),
      runtime: { ...runtime, options: loadOptions },
      audio,
      loadSeconds,
      coldLoad: setup.coldLoad,
      warmupSeconds,
      memory: null,
      gpuPower: null,
      load: null,
      plan: setup.plan
    }
    fs.writeFileSync(file, `${JSON.stringify(run)}\n`)
    const utterances: UtteranceRecord[] = []
    for (const [index, utterance] of set.utterances.entries()) {
      const pcm = load(utterance.audio)
      let record: UtteranceRecord
      if (pcm) {
        const { text, seconds } = await engine.transcribe(pcm, set.locale)
        record = { type: 'utterance', id: utterance.id, audioSeconds: durationSeconds(pcm), reference: utterance.reference, text, seconds }
        process.stderr.write(`  ${model.id} ${index + 1}/${set.utterances.length} ${seconds.toFixed(2)} s\n`)
      } else {
        record = { type: 'utterance', id: utterance.id, reference: utterance.reference, droppedBy: 'no-voice' }
        process.stderr.write(`  ${model.id} ${index + 1}/${set.utterances.length} no voice found\n`)
      }
      utterances.push(record)
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`)
    }
    const watched = await watch.stop()
    await engine.stop()
    fs.writeFileSync(file, resultText({ run: { ...run, ...watched, load: await watch.after() }, utterances }))
    return file
  } catch (error) {
    const log = engine.log ? ` (server log: ${engine.log})` : ''
    throw new Error(`${model.id} failed${log}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  } finally {
    await watch.close()
    await engine.stop()
  }
}
