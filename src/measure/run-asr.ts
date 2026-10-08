import fs from 'node:fs'
import path from 'node:path'
import { modelCovers, VAD_MODEL, type AsrModel } from '../catalog/models.ts'
import type { UtteranceSet } from '../datasets/item.ts'
import { ensureModelFile, type ModelFile } from '../catalog/model-file.ts'
import { CrispAsr } from '../engines/crispasr.ts'
import type { AsrEngine } from '../engines/engine.ts'
import { LlamaServerAsr } from '../engines/llama-server.ts'
import { NEMO_SPEECH_LOAD_OPTIONS, nemoSpeechDevice, NemoSpeechAsr } from '../engines/nemo-speech.ts'
import { speechWorkerArgs } from '../engines/worker.ts'
import { WorkerAsr } from '../engines/worker-asr.ts'
import { VoiceDetector } from '../engines/voice-activity.ts'
import { gpuDevice, machineInfo } from '../core/platform.ts'
import { RESULT_FORMAT, type AsrRunRecord, type ModelRecord, type NewPreparation, type UtteranceRecord } from './result-file/format.ts'
import { runFile } from './runs.ts'
import { CRISPASR, ensureRuntime, ensureSpeechCpp, LLAMA_CPP, NEMO_SPEECH_CPP, releaseOf, type RuntimeIdentity } from '../catalog/runtimes.ts'
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

/**
 * The engine that runs the model, with its runtime and the options it is loaded with, after fetching or converting
 * whatever is missing.
 */
export async function prepareAsr(model: AsrModel): Promise<{ engine: AsrEngine; runtime: RuntimeIdentity; loadOptions: Readonly<Record<string, string>> }> {
  const files: string[] = []
  for (const file of model.files) files.push(await ensureModelFile(file))
  if (model.runtime === 'llama-server') {
    return { engine: new LlamaServerAsr(await ensureRuntime(LLAMA_CPP), model, files, gpuDevice()), runtime: releaseOf(LLAMA_CPP), loadOptions: {} }
  }
  const [gguf] = files
  if (!gguf || files.length !== 1) throw new Error(`${model.id} is one GGUF file in ${model.runtime}`)
  if (model.runtime === 'speech.cpp') {
    const { executable, runtime } = await ensureSpeechCpp()
    return { engine: new WorkerAsr({ name: model.id, executable, args: speechWorkerArgs(gguf, gpuDevice(), null) }, model), runtime, loadOptions: {} }
  }
  if (model.runtime === 'nemo-speech.cpp') {
    const engine = new NemoSpeechAsr(await ensureRuntime(NEMO_SPEECH_CPP), model, gguf, nemoSpeechDevice(gpuDevice()))
    return { engine, runtime: releaseOf(NEMO_SPEECH_CPP), loadOptions: NEMO_SPEECH_LOAD_OPTIONS }
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
    const { checkpoint, converter } = file
    return { source: 'huggingface', repo: checkpoint.repo, revision: checkpoint.revision, file: file.file, sha256: file.sha256, converter: { repository: converter.repository, commit: converter.commit, args: [...file.args] } }
  }
  return { source: 'huggingface', repo: file.repo, revision: file.revision, file: file.file, sha256: file.sha256, converter: null }
}

/** The model as a result records it. */
export const modelRecord = (model: { id: string; label: string; license: string; files: readonly ModelFile[] }): ModelRecord =>
  ({ id: model.id, label: model.label, license: model.license, files: model.files.map(fileRecord) })

const stamp = (date: Date): string => date.toISOString().replace(/[:.]/g, '-')

/**
 * Transcribes every utterance of the set with the model and writes one JSON line per utterance, so that
 * a run cut short still leaves what it measured. Returns the path of the result file.
 */
export async function runAsr(model: AsrModel, set: UtteranceSet, audio: NewPreparation): Promise<string> {
  if (!modelCovers(model, set.locale)) throw new Error(`${model.id} does not list ${set.locale} among its languages`)
  if (set.utterances.length === 0) throw new Error(`${set.name} has no utterances`)
  const { engine, runtime, loadOptions } = await prepareAsr(model)
  const detector = audio.edges === 'voice' ? await VoiceDetector.open(VAD_MODEL) : null
  const startedAt = new Date()
  const machine = machineInfo()
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
      warmupSeconds
    }
    fs.writeFileSync(file, `${JSON.stringify(run)}\n`)
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
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`)
    }
    return file
  } catch (error) {
    const log = engine.log ? ` (server log: ${engine.log})` : ''
    throw new Error(`${model.id} failed${log}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  } finally {
    await engine.stop()
  }
}
