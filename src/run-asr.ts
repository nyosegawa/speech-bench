import fs from 'node:fs'
import path from 'node:path'
import { modelCovers, type AsrModel } from './catalog.ts'
import type { UtteranceSet } from './datasets/item.ts'
import { CrispAsr } from './engines/crispasr.ts'
import type { AsrEngine } from './engines/engine.ts'
import { LlamaServerAsr } from './engines/llama-server.ts'
import { resultsDir } from './paths.ts'
import { gpuDevice, machineInfo } from './platform.ts'
import { RESULT_FORMAT, type AsrRunRecord, type AudioPreparation, type UtteranceRecord } from './results.ts'
import { CRISPASR, ensureRuntime, LLAMA_CPP, type RuntimeSpec } from './runtimes.ts'
import { ensurePinned } from './store.ts'
import { cutLikeAsist } from './vad.ts'
import { durationSeconds, peakNormalize, readWav, withTrailingSilence, type Pcm } from './wav.ts'

/**
 * ASIST's preparation cuts the edges where its VAD opens and closes a capture, keeping the hangover
 * silence at the end, and scales the result to a peak of 0.9. The recording is scaled first as well:
 * ASIST's VAD has a fixed lowest threshold, and 18 of the first 100 Japanese FLEURS recordings never reach
 * it at their recorded level, which a microphone's gain would have raised. Null when ASIST's VAD keeps
 * nothing of the recording, so that no model hears it.
 */
export function prepareAudio(pcm: Pcm, preparation: AudioPreparation): Pcm | null {
  if (preparation.edges === 'as-recorded') return withTrailingSilence(pcm, preparation.trailingSilence)
  const cut = cutLikeAsist(peakNormalize(pcm), preparation.hangoverMs)
  return cut && peakNormalize(cut)
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
  const startedAt = new Date()
  const machine = machineInfo()
  const loadStarted = performance.now()
  try {
    await engine.start()
    const loadSeconds = (performance.now() - loadStarted) / 1000
    const load = (file: string): Pcm | null => prepareAudio(readWav(fs.readFileSync(file)), audio)
    let warmup: Pcm | null = null
    for (const utterance of set.utterances) {
      warmup = load(utterance.audio)
      if (warmup) break
    }
    if (!warmup) throw new Error(`ASIST's VAD drops every utterance of ${set.name}; there is nothing to transcribe`)
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
        record = { type: 'utterance', id: utterance.id, reference: utterance.reference, droppedBy: 'asist-vad' }
        process.stderr.write(`  ${model.id} ${index + 1}/${set.utterances.length} dropped by ASIST's VAD\n`)
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
