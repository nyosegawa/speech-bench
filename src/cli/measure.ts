import { parseArgs } from 'node:util'
import { ASR_MODELS, asrModel, SPEAKER_MODEL, TTS_MODELS, ttsModel } from '../catalog/models.ts'
import { analyzeRun } from '../analysis/run-analysis.ts'
import { SpeakerEmbedder } from '../engines/speaker-embedding.ts'
import { fleursLocales, fleursTestSet } from '../datasets/fleurs.ts'
import { commonVoiceLocales, commonVoiceTestSet } from '../datasets/common-voice.ts'
import type { UtteranceSet } from '../datasets/item.ts'
import { recordingSet } from '../datasets/recordings.ts'
import { loadDesigns } from '../make/recipes.ts'
import { loadPrompts } from '../datasets/prompts.ts'
import { isLanguageTag } from '../core/language.ts'
import { joinCampaign, readCampaign } from '../measure/campaigns.ts'
import { allRunFiles, runFile, runIdOf } from '../measure/runs.ts'
import { loadReference } from '../make/references.ts'
import { formatReport, readSummaries } from '../measure/report.ts'
import { readResultFile } from '../measure/result-file/file.ts'
import type { NewPreparation } from '../measure/result-file/format.ts'
import { runAsr, TRIM_TO_VOICE } from '../measure/run-asr.ts'
import { runTts } from '../measure/run-tts.ts'

export function listModels(): void {
  const describe = (model: { id: string; label: string; runtime: string; license: string; languages: readonly string[] }): string =>
    `${model.id}\n  ${model.label}, ${model.runtime}, ${model.license}\n  model card languages: ${model.languages.join(', ')}`
  console.log(['Speech recognition', ...ASR_MODELS.map(describe), '', 'Speech synthesis', ...TTS_MODELS.map(describe)].join('\n'))
}

function audioPreparation(edges: string | undefined, margin: string | undefined, trailingSilence: string | undefined): NewPreparation {
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

/** The result files a command reads: those named, those of a campaign, or every run. */
export function runFilesOf(named: readonly string[], campaign: string | undefined): string[] {
  if (campaign === undefined) return named.length > 0 ? [...named] : allRunFiles()
  if (named.length > 0) throw new Error('name runs or a campaign, not both')
  return readCampaign(campaign).runs.map(runFile)
}

/** Analyzes the speech of synthesis runs made before a run was analyzed as it ended, or made again after a change. */
export async function analyze(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { campaign: { type: 'string' } } })
  const files = runFilesOf(positionals, values.campaign).filter((file) => readResultFile(file).run.task === 'tts')
  const embedder = await SpeakerEmbedder.open(SPEAKER_MODEL)
  files.forEach((file, index) => {
    process.stderr.write(`${index + 1}/${files.length} ${runIdOf(file)}\n`)
    analyzeRun(file, embedder)
  })
  console.log(`analyzed ${files.length} synthesis run${files.length === 1 ? '' : 's'}`)
}

export async function asr(args: string[]): Promise<void> {
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
      'trailing-silence': { type: 'string' },
      campaign: { type: 'string' }
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
  } else if (values.set === 'common-voice') {
    if (values.speaker !== undefined) throw new Error('--speaker goes with --set recordings')
    const count = Number(values.count ?? 100)
    if (!Number.isInteger(count) || count < 1) throw new Error('--count is a whole number of utterances')
    set = await commonVoiceTestSet(locale, count)
  } else if (values.set === 'recordings') {
    if (values.count !== undefined) throw new Error('--count goes with --set fleurs; a speaker\'s recordings are measured whole')
    if (!values.speaker) throw new Error('--set recordings needs --speaker, the name the recordings were made under')
    set = recordingSet({ locale, speaker: values.speaker })
  } else {
    throw new Error(`--set is fleurs (pinned for ${fleursLocales().join(', ')}), common-voice (${commonVoiceLocales().join(', ')}) or recordings`)
  }
  const files: string[] = []
  for (const model of models) {
    process.stderr.write(`${model.id} on ${set.name}\n`)
    const file = await runAsr(model, set, audio)
    if (values.campaign !== undefined) joinCampaign(values.campaign, runIdOf(file))
    files.push(file)
  }
  console.log(formatReport(readSummaries(files)))
  console.log(`\n${files.join('\n')}`)
}

export async function tts(args: string[]): Promise<void> {
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
      only: { type: 'string' },
      campaign: { type: 'string' }
    }
  })
  const locale = values.locale
  if (!locale || !isLanguageTag(locale)) throw new Error('--locale is a BCP 47 tag such as ja-JP or en-US')
  if (!values.models) throw new Error('--models names one or more synthesis models, separated by commas')
  const models = values.models.split(',').map((id) => ttsModel(id.trim()))
  const seeds = values.seeds === undefined ? [null] : seedList(values.seeds)
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
        const file = await runTts(model, locale, sentences, { voice: values.voice, seed, design, reference, durationScale })
        if (values.campaign !== undefined) joinCampaign(values.campaign, runIdOf(file))
        files.push(file)
      }
    }
  }
  console.log(formatReport(readSummaries(files)))
  console.log(`\n${files.join('\n')}`)
}

export const seedList = (given: string): number[] => given.split(',').map((seed) => {
  const value = Number(seed.trim())
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--seeds lists whole numbers from 0, separated by commas, not ${JSON.stringify(seed)}`)
  return value
})
