import fs from 'node:fs'
import path from 'node:path'
import { asrModel, modelCovers, ttsVoiceFor, type TtsModel } from './catalog.ts'
import type { VoiceDesign } from './datasets/designs.ts'
import type { Prompt } from './datasets/prompts.ts'
import type { ReferenceVoice } from './references.ts'
import { AudioCppTts } from './engines/audiocpp.ts'
import { Qwen3TtsWorker } from './engines/qwen3-tts-worker.ts'
import type { Synthesis, TtsEngine } from './engines/tts-engine.ts'
import { resultsDir } from './paths.ts'
import { gpuBackend, gpuDevice, machineInfo } from './platform.ts'
import { RESULT_FORMAT, type SentenceRecord, type TtsRunRecord } from './results.ts'
import { prepareAsr } from './run-asr.ts'
import { AUDIO_CPP, ensureRuntime, QWEN3_TTS_GGML, type RuntimeSpec } from './runtimes.ts'
import { ensurePinned } from './store.ts'
import { durationSeconds, encodeWav16, peakNormalize, resample } from './wav.ts'

/** The model the synthesized speech is transcribed with: the most accurate local recognizer measured (FLEURS ja-JP 5.31%, 2026-09-30). */
const RECOGNIZER = 'qwen3-asr-1.7b'

/**
 * How a run picks the voice a model speaks with, a built-in voice, the seed it samples from, a voice described
 * in words or a reference, and what the predicted length of each sentence is multiplied by.
 */
export interface VoiceChoice {
  voice: string | undefined
  seed: number | null
  design: VoiceDesign | null
  reference: ReferenceVoice | null
  durationScale: number | null
}

async function prepareTts(model: TtsModel, { seed, design, reference, durationScale }: VoiceChoice): Promise<{ engine: TtsEngine; runtime: RuntimeSpec; loadOptions: Readonly<Record<string, string>> }> {
  if (model.runtime === 'qwen3-tts-worker' && seed !== null) throw new Error(`${model.id} runs in the Qwen3-TTS worker, which takes no seed`)
  if (design !== null && !(model.runtime === 'audio.cpp' && model.voiceDesign)) throw new Error(`${model.id} takes no voice described in words`)
  if (reference !== null && !(model.runtime === 'audio.cpp' && model.voiceReference)) throw new Error(`${model.id} takes no reference voice`)
  if (durationScale !== null && !(model.runtime === 'audio.cpp' && model.durationScale)) throw new Error(`${model.id} takes no factor for the length of its speech`)
  const files: string[] = []
  for (const file of model.files) files.push(await ensurePinned(file))
  if (model.runtime === 'qwen3-tts-worker') {
    return { engine: new Qwen3TtsWorker(await ensureRuntime(QWEN3_TTS_GGML), model, files, gpuDevice()), runtime: QWEN3_TTS_GGML, loadOptions: {} }
  }
  const [gguf] = files
  if (!gguf) throw new Error(`${model.id} has no GGUF`)
  const runOptions = { ...(seed === null ? {} : { seed }), ...(design === null ? {} : { instruction: design.instruction }), ...(durationScale === null ? {} : { duration_scale: durationScale }) }
  return { engine: new AudioCppTts(await ensureRuntime(AUDIO_CPP), model, gguf, gpuBackend(), runOptions, reference?.file ?? null), runtime: AUDIO_CPP, loadOptions: model.loadOptions[gpuBackend()] ?? {} }
}

const stamp = (date: Date): string => date.toISOString().replace(/[:.]/g, '-')

interface Spoken {
  prompt: Prompt
  audio: string
  synthesis: Synthesis
}

/**
 * Speaks every sentence with the model and saves the audio beside the result file, then transcribes the
 * audio with the recognizer, which runs only after the synthesis model has stopped so that the two do not
 * share the GPU while the synthesis is timed. Returns the path of the result file.
 */
export async function runTts(model: TtsModel, locale: string, sentences: readonly Prompt[], choice: VoiceChoice): Promise<string> {
  const { seed, design, reference, durationScale } = choice
  if (!modelCovers(model, locale)) throw new Error(`${model.id} does not list ${locale} among its languages`)
  const first = sentences[0]
  if (!first) throw new Error('there are no sentences to speak')
  const voice = ttsVoiceFor(model, locale, choice.voice)
  const recognizer = asrModel(RECOGNIZER)
  if (!modelCovers(recognizer, locale)) throw new Error(`${recognizer.id} cannot transcribe ${locale}, so the speech cannot be checked`)
  const startedAt = new Date()
  const machine = machineInfo()
  const setName = `speak-${locale}-${sentences.length}`
  const stem = `tts-${stamp(startedAt)}-${machine.hostname}-${model.id}${voice ? `-${voice}` : ''}${design === null ? '' : `-${design.id}`}${reference === null ? '' : `-ref-${reference.name}`}${durationScale === null ? '' : `-duration${durationScale}`}${seed === null ? '' : `-seed${seed}`}-${setName}`
  const audioFolder = path.join(resultsDir(), stem)
  fs.mkdirSync(audioFolder, { recursive: true })

  const { engine, runtime, loadOptions } = await prepareTts(model, choice)
  const spoken: Spoken[] = []
  let loadSeconds = 0
  let warmupSeconds = 0
  try {
    const loadStarted = performance.now()
    await engine.start()
    loadSeconds = (performance.now() - loadStarted) / 1000
    warmupSeconds = (await engine.synthesize(first.text, locale, voice)).totalSeconds
    for (const [index, prompt] of sentences.entries()) {
      const synthesis = await engine.synthesize(prompt.text, locale, voice)
      const audio = `${prompt.id}.wav`
      fs.writeFileSync(path.join(audioFolder, audio), encodeWav16(synthesis.pcm))
      spoken.push({ prompt, audio, synthesis })
      process.stderr.write(`  ${model.id} ${index + 1}/${sentences.length} first audio ${synthesis.firstAudioSeconds.toFixed(2)} s\n`)
    }
  } catch (error) {
    const log = engine.log ? ` (log: ${engine.log})` : ''
    throw new Error(`${model.id} failed${log}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  } finally {
    await engine.stop()
  }

  process.stderr.write(`  transcribing with ${recognizer.id}\n`)
  const { engine: asr } = await prepareAsr(recognizer)
  const records: SentenceRecord[] = []
  try {
    await asr.start()
    for (const { prompt, audio, synthesis } of spoken) {
      const heard = await asr.transcribe(peakNormalize(resample(synthesis.pcm, 16_000)), locale)
      records.push({
        type: 'sentence',
        id: prompt.id,
        kind: prompt.kind,
        text: prompt.text,
        audio,
        audioSeconds: durationSeconds(synthesis.pcm),
        firstAudioSeconds: synthesis.firstAudioSeconds,
        totalSeconds: synthesis.totalSeconds,
        transcript: heard.text
      })
    }
  } finally {
    await asr.stop()
  }

  const run: TtsRunRecord = {
    type: 'run',
    format: RESULT_FORMAT,
    task: 'tts',
    startedAt: startedAt.toISOString(),
    machine,
    set: { name: setName, locale, size: sentences.length },
    model: { id: model.id, label: model.label, license: model.license, files: model.files.map(({ repo, revision, file, sha256 }) => ({ repo, revision, file, sha256 })) },
    runtime: { id: runtime.id, version: runtime.version, options: loadOptions },
    voice,
    seed,
    design: design === null ? null : { id: design.id, instruction: design.instruction },
    reference: reference === null ? null : { name: reference.name, sha256: reference.sha256, seconds: reference.seconds },
    durationScale,
    recognizer: { id: recognizer.id, label: recognizer.label },
    loadSeconds,
    warmupSeconds
  }
  const file = path.join(resultsDir(), `${stem}.jsonl`)
  fs.writeFileSync(file, [run, ...records].map((record) => JSON.stringify(record)).join('\n') + '\n')
  return file
}
