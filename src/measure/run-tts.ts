import fs from 'node:fs'
import path from 'node:path'
import { asrModel, modelCovers, SPEAKER_MODEL, ttsVoiceFor, type AsrModel, type TtsModel } from '../catalog/models.ts'
import { analyzeRun } from '../analysis/run-analysis.ts'
import { SpeakerEmbedder } from '../engines/speaker-embedding.ts'
import type { VoiceDesign } from '../make/recipes.ts'
import type { Prompt } from '../datasets/prompts.ts'
import type { ReferenceVoice } from '../make/references.ts'
import { AudioCppTts } from '../engines/audiocpp.ts'
import { irodoriVoiceFile } from '../engines/irodori-voice.ts'
import { REFERENCE_VOICE, speechWorkerArgs } from '../engines/worker.ts'
import { WorkerTts } from '../engines/worker-tts.ts'
import type { Synthesis, TtsEngine } from '../engines/tts-engine.ts'
import { gpuBackend, machineInfo, platformKey, torchDevice } from '../core/platform.ts'
import { resultText } from './result-file/file.ts'
import { RESULT_FORMAT, type SentenceRecord, type TtsRunRecord } from './result-file/format.ts'
import { RuntimeWatch, type Watched } from './watch.ts'
import { checkSetupFor, DEFAULT_SETUP, deviceOf, filesFor, modelFiles, modelRecord, prepareAsr, type RunSetup } from './run-asr.ts'
import { runFile, runFolder } from './runs.ts'
import { AUDIO_CPP, ensureRuntime, ensureSpeechCpp, releaseOf, runtimeTag, SPEECH_CPP, type RuntimeIdentity } from '../catalog/runtimes.ts'
import { describeRuntime } from './report.ts'
import { adapterCommand, adapterVersion, IRODORI_TTS_ADAPTER, MLX_AUDIO_ADAPTER, QWEN3_TTS_ADAPTER, syncAdapter, type Adapter } from '../engines/adapter.ts'
import { durationSeconds, encodeWav16, peakNormalize, resample } from '../core/wav.ts'

/** The model the synthesized speech is transcribed with: the most accurate local recognizer measured (FLEURS ja-JP 5.31%, 2026-09-30). */
const RECOGNIZER = 'qwen3-asr-1.7b'

/**
 * The second recognizer, of another family than Qwen3-ASR, so that a synthesis model of Qwen's family is not judged
 * only by a recognizer that may hear it more kindly: ReazonSpeech NeMo v2, a FastConformer of Japanese alone, with its
 * checkpoint's beam search, in the release of speech.cpp the bench pins, whatever build a run measures. A locale it
 * does not transcribe has none.
 */
const SECOND_RECOGNIZER = 'reazonspeech-nemo-v2-speech.cpp'

/** What the recognizer heard in each sentence's speech, resampled to 16 kHz and scaled to a peak of 0.9. */
async function transcribeSpeech(recognizer: AsrModel, setup: RunSetup, spoken: readonly Spoken[], locale: string): Promise<{ texts: string[]; runtime: RuntimeIdentity }> {
  process.stderr.write(`  transcribing with ${recognizer.id}\n`)
  const { engine, runtime } = await prepareAsr(recognizer, await modelFiles(recognizer), setup)
  try {
    await engine.start()
    const texts: string[] = []
    for (const { synthesis } of spoken) texts.push((await engine.transcribe(peakNormalize(resample(synthesis.pcm, 16_000)), locale)).text)
    return { texts, runtime }
  } finally {
    await engine.stop()
  }
}

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

/** The options every request of a run carries: the sampler's steps when not the model's own. */
const stepsOption = (steps: number | null): Record<string, number> => (steps === null ? {} : { steps })

interface PreparedTts {
  engine: TtsEngine
  runtime: RuntimeIdentity
  loadOptions: Readonly<Record<string, string>>
  /** Removes the copies of the model files a cold load read, once the runtime has stopped. */
  remove: () => void
}

/**
 * The engine that runs the model, with its runtime and the options it is loaded with. A voice file is made from the
 * model file before any copy for a cold load, so that making it does not bring the copy into the file cache.
 */
async function prepareTts(model: TtsModel, { seed, design, reference, durationScale }: VoiceChoice, setup: RunSetup): Promise<PreparedTts> {
  if (design !== null && !(model.runtime === 'audio.cpp' && model.voiceDesign)) throw new Error(`${model.id} takes no voice described in words`)
  if (reference !== null && !model.voiceReference) throw new Error(`${model.id} takes no reference voice`)
  if (durationScale !== null && !(model.runtime === 'audio.cpp' && model.durationScale)) throw new Error(`${model.id} takes no factor for the length of its speech`)
  checkSetupFor(model, setup)
  if (model.runtime === 'speech.cpp') {
    if (model.voiceReference && reference === null) throw new Error(`${model.id} has no voice of its own; give it one with --reference`)
    const [modelGguf, ...others] = await modelFiles(model)
    if (!modelGguf || others.length > 0) throw new Error(`${model.id} is one GGUF file in speech.cpp`)
    const { executable, runtime } = await ensureSpeechCpp(setup.speechCpp)
    const { device, options } = deviceOf(setup)
    const voiceFile = reference === null ? null : await irodoriVoiceFile({ executable, version: runtimeTag(runtime) }, modelGguf, reference)
    const { files: [gguf], remove } = await filesFor(model, setup)
    const engine = new WorkerTts(
      { name: model.id, executable, args: speechWorkerArgs(gguf!, device, voiceFile) },
      { voice: voiceFile === null ? null : REFERENCE_VOICE, seed, options: stepsOption(model.steps) }
    )
    return { engine, runtime, loadOptions: { ...(voiceFile === null ? {} : { voice: 'voice file made on the CPU' }), ...options }, remove }
  }
  // The runtime is fetched and the adapter installed before the copies are made, so that neither leaves copies behind.
  const audioCpp = model.runtime === 'audio.cpp' ? await ensureRuntime(AUDIO_CPP) : null
  if (model.runtime === 'adapter') syncAdapter(SYNTHESIS_ADAPTERS[model.adapter])
  const { files, remove } = await filesFor(model, setup)
  if (model.runtime === 'adapter') {
    if (model.voiceReference && reference === null) throw new Error(`${model.id} has no voice of its own; give it one with --reference`)
    const fileOf = (name: string): string => files[model.files.findIndex((file) => file.file === name)]!
    const voice = reference === null ? [] : ['--add-voice', `${REFERENCE_VOICE}=${reference.file}`]
    const adapter = SYNTHESIS_ADAPTERS[model.adapter]
    const { args, loadOptions } = adapterRun(model, fileOf, voice)
    const engine = new WorkerTts(adapterCommand(adapter, model.id, args), { voice: reference === null ? null : REFERENCE_VOICE, seed, options: stepsOption(model.steps) })
    return { engine, runtime: releaseOf({ id: adapter.id, version: adapterVersion(adapter) }), loadOptions, remove }
  }
  const [gguf] = files
  if (!gguf) throw new Error(`${model.id} has no GGUF`)
  const runOptions = { ...(seed === null ? {} : { seed }), ...(design === null ? {} : { instruction: design.instruction }), ...(durationScale === null ? {} : { duration_scale: durationScale }) }
  return { engine: new AudioCppTts(audioCpp!, model, gguf, gpuBackend(), runOptions, reference?.file ?? null), runtime: releaseOf(AUDIO_CPP), loadOptions: model.loadOptions[gpuBackend()] ?? {}, remove }
}

/** The adapter of each synthesis model the catalog runs in one. */
const SYNTHESIS_ADAPTERS: Record<Extract<TtsModel, { runtime: 'adapter' }>['adapter'], Adapter> = {
  'irodori-tts': IRODORI_TTS_ADAPTER,
  'mlx-audio': MLX_AUDIO_ADAPTER,
  'qwen3-tts': QWEN3_TTS_ADAPTER
}

/**
 * The arguments of the adapter that runs a synthesis model and the options it is loaded with. The official
 * implementations run in PyTorch on the GPU of the machine, Irodori-TTS in the precision of the model's entry and the
 * others in the precision they are released in; mlx-audio runs only on Apple silicon.
 */
function adapterRun(model: Extract<TtsModel, { runtime: 'adapter' }>, fileOf: (name: string) => string, voice: readonly string[]): { args: string[]; loadOptions: Record<string, string> } {
  if (model.adapter === 'mlx-audio') {
    if (platformKey() !== 'darwin-arm64') throw new Error('mlx-audio runs on Apple silicon alone')
    return { args: ['--model', path.dirname(fileOf('config.json')), ...voice], loadOptions: { device: 'metal', precision: 'fp16' } }
  }
  const device = torchDevice()
  if (model.adapter === 'irodori-tts') {
    const args = ['--checkpoint', fileOf('model.safetensors'), '--codec', fileOf('weights.pth'), '--device', device, '--precision', model.precision, ...voice]
    return { args, loadOptions: { device, precision: model.precision } }
  }
  return { args: ['--model', path.dirname(fileOf('config.json')), '--device', device], loadOptions: { device, precision: 'bf16' } }
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
export async function runTts(model: TtsModel, locale: string, sentences: readonly Prompt[], choice: VoiceChoice, setup: RunSetup = DEFAULT_SETUP): Promise<string> {
  const { seed, design, reference, durationScale } = choice
  if (!modelCovers(model, locale)) throw new Error(`${model.id} does not list ${locale} among its languages`)
  const first = sentences[0]
  if (!first) throw new Error('there are no sentences to speak')
  const voice = ttsVoiceFor(model, locale, choice.voice)
  const recognizer = asrModel(RECOGNIZER)
  const secondRecognizer = asrModel(SECOND_RECOGNIZER)
  if (!modelCovers(recognizer, locale)) throw new Error(`${recognizer.id} cannot transcribe ${locale}, so the speech cannot be checked`)
  const startedAt = new Date()
  const machine = machineInfo()
  const setName = `speak-${locale}-${sentences.length}`
  const stem = `tts-${stamp(startedAt)}-${machine.hostname}-${model.id}${voice ? `-${voice}` : ''}${design === null ? '' : `-${design.id}`}${reference === null ? '' : `-ref-${reference.name}`}${durationScale === null ? '' : `-duration${durationScale}`}${seed === null ? '' : `-seed${seed}`}-${setName}`
  const audioFolder = runFolder(stem)
  fs.mkdirSync(audioFolder, { recursive: true })

  const { engine, runtime, loadOptions, remove } = await prepareTts(model, choice, setup)
  const spoken: Spoken[] = []
  let loadSeconds = 0
  let warmupSeconds = 0
  let watched: Watched = { memory: null, gpuPower: null, load: null }
  let watch: RuntimeWatch | null = null
  try {
    watch = await RuntimeWatch.start(machine, () => engine.pid)
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
    const read = await watch.stop()
    await engine.stop()
    watched = { ...read, load: await watch.after() }
  } catch (error) {
    const log = engine.log ? ` (log: ${engine.log})` : ''
    throw new Error(`${model.id} failed${log}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  } finally {
    await watch?.close()
    await engine.stop()
    remove()
  }

  const heard = await transcribeSpeech(recognizer, DEFAULT_SETUP, spoken, locale)
  const second = modelCovers(secondRecognizer, locale)
    ? await transcribeSpeech(secondRecognizer, { ...DEFAULT_SETUP, speechCpp: SPEECH_CPP.version }, spoken, locale)
    : null
  const records: SentenceRecord[] = spoken.map(({ prompt, audio, synthesis }, index) => ({
    type: 'sentence',
    id: prompt.id,
    kind: prompt.kind,
    text: prompt.text,
    audio,
    audioSeconds: durationSeconds(synthesis.pcm),
    firstAudioSeconds: synthesis.firstAudioSeconds,
    totalSeconds: synthesis.totalSeconds,
    chunks: synthesis.chunks,
    transcript: heard.texts[index]!,
    secondTranscript: second === null ? null : second.texts[index]!
  }))

  const run: TtsRunRecord = {
    type: 'run',
    format: RESULT_FORMAT,
    task: 'tts',
    startedAt: startedAt.toISOString(),
    machine,
    set: { name: setName, locale, size: sentences.length },
    model: modelRecord(model),
    runtime: { ...runtime, options: loadOptions },
    voice,
    seed,
    design: design === null ? null : { id: design.id, instruction: design.instruction },
    reference: reference === null ? null : { name: reference.name, sha256: reference.sha256, seconds: reference.seconds },
    durationScale,
    recognizer: { id: recognizer.id, label: recognizer.label },
    secondRecognizer: second === null ? null : { id: secondRecognizer.id, label: secondRecognizer.label, runtime: describeRuntime({ ...second.runtime, options: {} }) },
    loadSeconds,
    coldLoad: setup.coldLoad,
    warmupSeconds,
    ...watched,
    plan: setup.plan
  }
  const file = runFile(stem)
  fs.writeFileSync(file, resultText({ run, sentences: records }))
  // Analyzed now, a run's speech is never analyzed while someone waits for a page.
  process.stderr.write(`  analyzing the speech with ${SPEAKER_MODEL.id}\n`)
  analyzeRun(file, await SpeakerEmbedder.open(SPEAKER_MODEL))
  return file
}
