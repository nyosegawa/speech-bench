import fs from 'node:fs'
import path from 'node:path'
import { modelCovers, VAD_MODEL, type AsrModel } from './catalog.ts'
import type { UtteranceSet } from './datasets/item.ts'
import { CrispAsr } from './engines/crispasr.ts'
import type { AsrEngine } from './engines/engine.ts'
import { LlamaServerAsr } from './engines/llama-server.ts'
import { VoiceDetector } from './engines/voice-activity.ts'
import { resultsDir } from './paths.ts'
import { gpuDevice, machineInfo } from './platform.ts'
import { RESULT_FORMAT, type AsrRunRecord, type AudioPreparation, type UtteranceRecord } from './results.ts'
import { CRISPASR, ensureRuntime, LLAMA_CPP, type RuntimeSpec } from './runtimes.ts'
import { ensurePinned } from './store.ts'
import { durationSeconds, peakNormalize, readWav, trimAround, withTrailingSilence, type Pcm } from './wav.ts'

/** How utterances are prepared unless a run asks otherwise. */
export const TRIM_TO_VOICE: Extract<AudioPreparation, { edges: 'voice' }> = { edges: 'voice', detector: VAD_MODEL.id, marginSeconds: 0.2 }

/**
 * The audio a model hears: trimmed to the voice the detector finds with the margin around it and scaled to a
 * peak of 0.9, or as recorded with silence after it. Null when the detector finds no voice, so that no model
 * hears the utterance.
 */
export function prepareAudio(pcm: Pcm, preparation: AudioPreparation, detector: Pick<VoiceDetector, 'voiceSpan'> | null): Pcm | null {
  if (preparation.edges === 'as-recorded') return withTrailingSilence(pcm, preparation.trailingSilence)
  if (preparation.edges === 'asist') throw new Error('utterances are no longer cut the way ASIST cut them; use --edges voice or as-recorded')
  if (!detector) throw new Error('trimming to the voice needs a voice detector')
  const span = detector.voiceSpan(pcm)
  return span && peakNormalize(trimAround(pcm, span.start, span.end, preparation.marginSeconds))
}

/** The engine that runs the model, with its runtime, after fetching whatever is missing. */
export async function prepareAsr(model: AsrModel): Promise<{ engine: AsrEngine; runtime: RuntimeSpec }> {
  const files: string[] = []
  for (const file of model.files) files.push(await ensurePinned(file))
  if (model.runtime === 'llama-server') {
    return { engine: new LlamaServerAsr(await ensureRuntime(LLAMA_CPP), model, files, gpuDevice()), runtime: LLAMA_CPP }
  }
  const [gguf] = files
  if (!gguf) throw new Error(`${model.id} has no GGUF`)
  return { engine: new CrispAsr(await ensureRuntime(CRISPASR), model, gguf), runtime: CRISPASR }
}

const stamp = (date: Date): string => date.toISOString().replace(/[:.]/g, '-')

/**
 * Transcribes every utterance of the set with the model and writes one JSON line per utterance, so that
 * a run cut short still leaves what it measured. Returns the path of the result file.
 */
export async function runAsr(model: AsrModel, set: UtteranceSet, audio: AudioPreparation): Promise<string> {
  if (!modelCovers(model, set.locale)) throw new Error(`${model.id} does not list ${set.locale} among its languages`)
  if (set.utterances.length === 0) throw new Error(`${set.name} has no utterances`)
  const { engine, runtime } = await prepareAsr(model)
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
    fs.mkdirSync(resultsDir(), { recursive: true })
    const file = path.join(resultsDir(), `asr-${stamp(startedAt)}-${machine.hostname}-${model.id}-${set.name}.jsonl`)
    const run: AsrRunRecord = {
      type: 'run',
      format: RESULT_FORMAT,
      task: 'asr',
      startedAt: startedAt.toISOString(),
      machine,
      set: { name: set.name, locale: set.locale, size: set.utterances.length },
      model: { id: model.id, label: model.label, license: model.license, files: model.files.map(({ repo, revision, file: name, sha256 }) => ({ repo, revision, file: name, sha256 })) },
      runtime: { id: runtime.id, version: runtime.version, options: {} },
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
