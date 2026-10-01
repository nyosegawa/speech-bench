import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { ASR_MODELS, asrModel, modelCovers, SPEAKER_MODEL, TTS_MODELS, ttsModel } from './catalog.ts'
import { SpeakerEmbedder } from './engines/speaker-embedding.ts'
import { fleursLocales, fleursTestSet } from './datasets/fleurs.ts'
import type { UtteranceSet } from './datasets/item.ts'
import { isSafeName, recordingSet } from './datasets/recordings.ts'
import { loadDesigns } from './datasets/designs.ts'
import { loadPrompts } from './datasets/prompts.ts'
import { startRecordingServer } from './record/server.ts'
import { isLanguageTag } from './language.ts'
import { dataDir, recordingsDir, resultsDir } from './paths.ts'
import { latestRuns, listeningPage, readTtsRuns } from './listen.ts'
import { embedGroups, largestSet, neighborGroups, neighborsPage, similarityOf } from './neighbors.ts'
import { candidateGroups, loadReference, referenceFile, referenceManifest, writeReference } from './references.ts'
import { allResultFiles, formatReport, readSummaries } from './report.ts'
import type { AudioPreparation, TtsRunRecord } from './results.ts'
import { runAsr, TRIM_TO_VOICE } from './run-asr.ts'
import { runTts } from './run-tts.ts'
import { voicesData, voicesPage } from './voices.ts'
import { readWav } from './wav.ts'

const USAGE = `usage:
  node src/cli.ts models
  node src/cli.ts asr --locale ja-JP --models qwen3-asr-1.7b,parakeet-tdt_ctc-0.6b-ja [--set fleurs [--count 100] | --set recordings --speaker name]
      [--edges voice [--margin 0.2] | --edges as-recorded [--trailing-silence 0]]
  node src/cli.ts tts --locale ja-JP --models qwen3-tts-0.6b,irodori-tts-v4-small [--voice ono_anna] [--seeds 1,2,3]
      [--designs young-woman-caption,young-man-caption] [--reference name] [--duration-scale 0.5] [--sentences sentences.json] [--only aizuchi-hai,reply-weather]
  node src/cli.ts record --locale ja-JP --speaker name [--prompts prompts.json]
  node src/cli.ts report [result.jsonl ...]
  node src/cli.ts listen [--blind] [--set speak-ja-JP-20] [--page name] [--reference name] [result.jsonl ...]
  node src/cli.ts neighbors [--page name] [result.jsonl ...]
  node src/cli.ts reference --name name [--threshold 0.8] [--seconds 30] [--candidates 6 | --takes sentence@seed,...] result.jsonl ...
  node src/cli.ts voices [--page name] [result.jsonl ...]

Downloads, recordings and results go to ${dataDir()} (SPEECH_BENCH_DATA moves them).`

function listModels(): void {
  const describe = (model: { id: string; label: string; runtime: string; license: string; languages: readonly string[] }): string =>
    `${model.id}\n  ${model.label}, ${model.runtime}, ${model.license}\n  model card languages: ${model.languages.join(', ')}`
  console.log(['Speech recognition', ...ASR_MODELS.map(describe), '', 'Speech synthesis', ...TTS_MODELS.map(describe)].join('\n'))
}

function audioPreparation(edges: string | undefined, margin: string | undefined, trailingSilence: string | undefined): AudioPreparation {
  if (edges === 'voice') {
    if (trailingSilence !== undefined) throw new Error('--trailing-silence goes with --edges as-recorded')
    const marginSeconds = margin === undefined ? TRIM_TO_VOICE.marginSeconds : Number(margin)
    if (!Number.isFinite(marginSeconds) || marginSeconds < 0 || marginSeconds > 2) throw new Error('--margin is seconds of the recording kept around the voice, from 0 to 2')
    return { ...TRIM_TO_VOICE, marginSeconds }
  }
  if (edges === 'as-recorded') {
    if (margin !== undefined) throw new Error('--margin goes with --edges voice')
    const seconds = Number(trailingSilence ?? 0)
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('--trailing-silence is seconds, 0 or more')
    return { edges: 'as-recorded', trailingSilence: seconds }
  }
  throw new Error('--edges is voice or as-recorded')
}

async function asr(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      locale: { type: 'string' },
      models: { type: 'string' },
      set: { type: 'string', default: 'fleurs' },
      count: { type: 'string' },
      speaker: { type: 'string' },
      edges: { type: 'string', default: 'voice' },
      margin: { type: 'string' },
      'trailing-silence': { type: 'string' }
    }
  })
  const locale = values.locale
  if (!locale || !isLanguageTag(locale)) throw new Error('--locale is a BCP 47 tag such as ja-JP or en-US')
  if (!values.models) throw new Error('--models names one or more models, separated by commas')
  const models = values.models.split(',').map((id) => asrModel(id.trim()))
  const audio = audioPreparation(values.edges, values.margin, values['trailing-silence'])
  let set: UtteranceSet
  if (values.set === 'fleurs') {
    if (values.speaker !== undefined) throw new Error('--speaker goes with --set recordings')
    const count = Number(values.count ?? 100)
    if (!Number.isInteger(count) || count < 1) throw new Error('--count is a whole number of utterances')
    set = await fleursTestSet(locale, count)
  } else if (values.set === 'recordings') {
    if (values.count !== undefined) throw new Error('--count goes with --set fleurs; a speaker\'s recordings are measured whole')
    if (!values.speaker) throw new Error('--set recordings needs --speaker, the name the recordings were made under')
    set = recordingSet({ locale, speaker: values.speaker })
  } else {
    throw new Error(`--set is fleurs (pinned for ${fleursLocales().join(', ')}) or recordings`)
  }
  const files: string[] = []
  for (const model of models) {
    process.stderr.write(`${model.id} on ${set.name}\n`)
    files.push(await runAsr(model, set, audio))
  }
  console.log(formatReport(readSummaries(files)))
  console.log(`\n${files.join('\n')}`)
}

async function tts(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      locale: { type: 'string' },
      models: { type: 'string' },
      voice: { type: 'string' },
      seeds: { type: 'string' },
      designs: { type: 'string' },
      reference: { type: 'string' },
      'duration-scale': { type: 'string' },
      sentences: { type: 'string' },
      only: { type: 'string' }
    }
  })
  const locale = values.locale
  if (!locale || !isLanguageTag(locale)) throw new Error('--locale is a BCP 47 tag such as ja-JP or en-US')
  if (!values.models) throw new Error('--models names one or more synthesis models, separated by commas')
  const models = values.models.split(',').map((id) => ttsModel(id.trim()))
  const seeds = values.seeds === undefined ? [null] : values.seeds.split(',').map((seed) => {
    const value = Number(seed.trim())
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--seeds lists whole numbers from 0, separated by commas, not ${JSON.stringify(seed)}`)
    return value
  })
  const designs = values.designs === undefined ? [null] : loadDesigns(locale, values.designs.split(',').map((id) => id.trim()))
  const reference = values.reference === undefined ? null : await loadReference(values.reference)
  const durationScale = values['duration-scale'] === undefined ? null : Number(values['duration-scale'])
  if (durationScale !== null && !(durationScale > 0 && durationScale <= 4)) throw new Error(`--duration-scale multiplies the predicted length of each sentence, a number above 0 and up to 4, not ${JSON.stringify(values['duration-scale'])}`)
  const all = loadPrompts('speak', locale, values.sentences)
  const only = values.only?.split(',').map((id) => id.trim())
  const unknown = only?.filter((id) => !all.some((prompt) => prompt.id === id)) ?? []
  if (unknown.length > 0) throw new Error(`--only names sentences that are not in the list: ${unknown.join(', ')}`)
  const sentences = only ? all.filter((prompt) => only.includes(prompt.id)) : all
  const files: string[] = []
  for (const model of models) {
    for (const design of designs) {
      for (const seed of seeds) {
        const how = [design === null ? '' : ` as ${design.id}`, seed === null ? '' : ` with seed ${seed}`].join('')
        process.stderr.write(`${model.id}${how} speaking ${sentences.length} sentences\n`)
        files.push(await runTts(model, locale, sentences, { voice: values.voice, seed, design, reference, durationScale }))
      }
    }
  }
  console.log(formatReport(readSummaries(files)))
  console.log(`\n${files.join('\n')}`)
}

async function record(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { locale: { type: 'string' }, speaker: { type: 'string' }, prompts: { type: 'string' } } })
  const locale = values.locale
  if (!locale || !isLanguageTag(locale)) throw new Error('--locale is a BCP 47 tag such as ja-JP or en-US')
  if (!values.speaker || !isSafeName(values.speaker)) throw new Error('--speaker names who records, in lower-case letters, digits, - and _')
  const prompts = loadPrompts('record', locale, values.prompts)
  const { url } = await startRecordingServer({ locale, speaker: values.speaker }, prompts)
  console.log(`Open ${url} in a browser to record ${prompts.length} prompts as ${values.speaker}. Recordings go to ${path.join(recordingsDir(), locale, values.speaker)}. Press Ctrl-C to stop.`)
}

/** The speaker embedding of each reference voice by name, embedded once. */
function referenceEmbeddings(embedder: SpeakerEmbedder): (name: string) => Float32Array {
  const embeddings = new Map<string, Float32Array>()
  return (name) => {
    const known = embeddings.get(name) ?? embedder.embed(readWav(fs.readFileSync(referenceFile(name))))
    embeddings.set(name, known)
    return known
  }
}

async function listen(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { blind: { type: 'boolean', default: false }, set: { type: 'string' }, page: { type: 'string' }, reference: { type: 'string' } }
  })
  if (values.page !== undefined && !isSafeName(values.page)) throw new Error('--page names the page in lower-case letters, digits, - and _')
  const embedder = await SpeakerEmbedder.open(SPEAKER_MODEL)
  const embeddingOf = referenceEmbeddings(embedder)
  // Each run is compared with the reference it spoke like, unless --reference names one for them all.
  const referenceOf = (run: TtsRunRecord): Float32Array | undefined => {
    const name = values.reference ?? run.reference?.name
    return name === undefined ? undefined : embeddingOf(name)
  }
  const inSet = (run: TtsRunRecord): boolean => values.set === undefined || run.set.name === values.set
  const runs = latestRuns(readTtsRuns(positionals.length > 0 ? positionals : allResultFiles(), embedder, inSet, referenceOf))
  if (runs.length === 0) throw new Error('there are no speech synthesis results to listen to; run "node src/cli.ts tts" first')
  const page = path.join(resultsDir(), `listen-${values.page ?? runs[0]!.run.set.name}${values.blind ? '-blind' : ''}.html`)
  fs.writeFileSync(page, listeningPage(runs, page, values.blind, Math.random, values.reference ?? null))
  console.log(page)
}

async function voices(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { page: { type: 'string' } } })
  if (values.page !== undefined && !isSafeName(values.page)) throw new Error('--page names the page in lower-case letters, digits, - and _')
  const embedder = await SpeakerEmbedder.open(SPEAKER_MODEL)
  const embeddingOf = referenceEmbeddings(embedder)
  const runs = latestRuns(readTtsRuns(positionals.length > 0 ? positionals : allResultFiles(), embedder, (run) => run.reference !== null, (run) => embeddingOf(run.reference!.name)))
  if (runs.length === 0) throw new Error('there are no runs that spoke like a reference voice; run "node src/cli.ts tts --reference name" first')
  const name = values.page ?? 'voices'
  const page = path.join(resultsDir(), `voices-${name}.html`)
  fs.writeFileSync(page, voicesPage(voicesData(runs, (reference) => ({ manifest: referenceManifest(reference), file: referenceFile(reference) }), page, name)))
  console.log(page)
}

async function neighbors(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { page: { type: 'string' } } })
  if (values.page !== undefined && !isSafeName(values.page)) throw new Error('--page names the page in lower-case letters, digits, - and _')
  const page = path.join(resultsDir(), `neighbors-${values.page ?? 'voices'}.html`)
  const groups = neighborGroups(embedGroups(positionals.length > 0 ? positionals : allResultFiles(), await SpeakerEmbedder.open(SPEAKER_MODEL)), page)
  if (groups.length === 0) throw new Error('there are no synthesized voices with two or more sentences long enough to compare; run "node src/cli.ts tts" first')
  fs.writeFileSync(page, neighborsPage(groups))
  console.log(page)
}

/**
 * Writes a reference voice from the takes of one intended voice: the largest set in which every pair is at
 * least the threshold alike, one take per sentence, taken in order of likeness to its center up to the length.
 */
async function reference(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { name: { type: 'string' }, threshold: { type: 'string', default: '0.8' }, seconds: { type: 'string', default: '30' }, candidates: { type: 'string' }, takes: { type: 'string' } }
  })
  if (!values.name) throw new Error('--name names the reference voice')
  const threshold = Number(values.threshold)
  const seconds = Number(values.seconds)
  if (!(threshold > 0 && threshold < 1)) throw new Error('--threshold is a similarity between 0 and 1')
  if (!(seconds > 0 && seconds <= 120)) throw new Error('--seconds is up to 120, the longest reference Irodori-TTS v4 Small takes')
  if (positionals.length === 0) throw new Error('name the result files of the takes to choose from')
  const groups = embedGroups(positionals, await SpeakerEmbedder.open(SPEAKER_MODEL))
  if (groups.length !== 1) throw new Error(`the result files hold ${groups.length} voices (${groups.map((group) => group.name).join('; ')}); name the files of one`)
  const [group] = groups
  const similarity = similarityOf(group!.takes)
  const write = (name: string, chosen: readonly number[], byHand = false): void => {
    const written = writeReference(name, group!.name, byHand ? null : threshold, chosen.map((member) => group!.takes[member]!), (a, b) => similarity[chosen[a]!]![chosen[b]!]!, byHand ? null : seconds)
    console.log(`${written.name}: ${written.takes.length} takes, ${written.seconds.toFixed(1)} s, every pair ${written.weakestPair.toFixed(2)} or more alike, ${written.meanSimilarity.toFixed(2)} on average`)
    for (const take of written.takes) console.log(`  ${take.likenessToCenter.toFixed(2)}  ${take.label}  ${take.text}`)
  }
  if (values.takes !== undefined) {
    if (values.candidates !== undefined) throw new Error('--takes names the takes of one reference; --candidates makes several from the set')
    // A take is named by its sentence and seed, sentence@seed, or by its sentence alone in a run without a seed.
    const chosen = values.takes.split(',').map((name) => {
      const [sentence, seed] = name.trim().split('@')
      const index = group!.takes.findIndex((take) => take.sentence === sentence && (seed === undefined ? take.seed === null : take.seed === Number(seed)))
      if (index < 0) throw new Error(`there is no take ${name.trim()} with enough voice among the result files`)
      return index
    })
    write(values.name, chosen, true)
    return
  }
  const sentences = group!.takes.map((take) => take.sentence)
  if (values.candidates === undefined) {
    write(values.name, largestSet(similarity, sentences, threshold, true).members)
    return
  }
  const count = Number(values.candidates)
  if (!Number.isInteger(count) || count < 1) throw new Error('--candidates is how many candidate references to make, a whole number')
  const candidates = candidateGroups(similarity, sentences, (take) => group!.takes[take]!.seconds, threshold, seconds, count)
  if (candidates.length < count) console.log(`the ${group!.takes.length} takes make ${candidates.length} candidates of ${seconds} s in which every pair is ${threshold} or more alike, not ${count}`)
  for (const [index, candidate] of candidates.entries()) write(`${values.name}-${index + 1}`, candidate)
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'models') listModels()
  else if (command === 'asr') await asr(rest)
  else if (command === 'tts') await tts(rest)
  else if (command === 'record') await record(rest)
  else if (command === 'listen') await listen(rest)
  else if (command === 'neighbors') await neighbors(rest)
  else if (command === 'voices') await voices(rest)
  else if (command === 'reference') await reference(rest)
  else if (command === 'report') console.log(formatReport(readSummaries(rest.length > 0 ? rest : allResultFiles())))
  else {
    console.error(USAGE)
    process.exitCode = 2
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
