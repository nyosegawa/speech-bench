import fs from 'node:fs'
import { campaignRuns, joinCampaign } from '../measure/campaigns.ts'
import { SPEAKER_MODEL, type TtsModel } from '../catalog/models.ts'
import type { Prompt } from '../datasets/prompts.ts'
import { SpeakerEmbedder } from '../engines/speaker-embedding.ts'
import { embedGroups } from '../analysis/neighbors.ts'
import { copyReference, loadReference, referenceNames, writeCandidates, type ReferenceManifest } from './references.ts'
import { parseResultFile } from '../measure/results.ts'
import { runFile, runIdOf } from '../measure/runs.ts'
import { runTts } from '../measure/run-tts.ts'
import { recordChoice, type Recipe } from './recipes.ts'

/**
 * Making a voice for a model without built-in ones, in four steps: gather takes of its description saying its
 * lines with several seeds, make candidate references of takes that sound like one voice, have the model
 * speak the measured sentences like each candidate, and record the one chosen by ear. Every run joins the
 * voice's campaign.
 */
export const voiceCampaign = (id: string): string => `voice-${id}`
export const candidateBase = (id: string): string => `${id}-candidate`
/** The reference a chosen voice is kept under, apart from its candidates, which can be made again. */
export const voiceReference = (id: string): string => `voice-${id}`

/**
 * The runs of a voice's campaign, as result files: the takes gathered from its description, which spoke like
 * no reference, and the tries of its candidates, which did.
 */
export function voiceRuns(id: string): { gathered: string[]; tried: string[] } {
  const runs = { gathered: [] as string[], tried: [] as string[] }
  for (const file of campaignRuns(voiceCampaign(id)).map(runFile)) {
    const { run } = parseResultFile(fs.readFileSync(file, 'utf8').split('\n'))
    if (run.task !== 'tts') throw new Error(`${runIdOf(file)} in campaign ${voiceCampaign(id)} is not a speech synthesis run`)
    runs[run.reference === null ? 'gathered' : 'tried'].push(file)
  }
  return runs
}

/** The candidate references made for a voice, `<id>-candidate-1` and on. */
export function candidatesOf(id: string): string[] {
  const base = candidateBase(id)
  return referenceNames(`${base}-`).filter((name) => /^\d+$/.test(name.slice(base.length + 1))).sort((a, b) => Number(a.slice(base.length + 1)) - Number(b.slice(base.length + 1)))
}

/** Takes of the voice's description saying its lines, one run for each seed. */
export async function gatherTakes(recipe: Recipe, locale: string, model: TtsModel, seeds: readonly number[]): Promise<string[]> {
  if (recipe.lines.length === 0) throw new Error(`${recipe.id} has no lines to say; give it lines in character before gathering takes`)
  const files: string[] = []
  for (const seed of seeds) {
    process.stderr.write(`${model.id} as ${recipe.id} with seed ${seed} saying ${recipe.lines.length} lines\n`)
    const file = await runTts(model, locale, recipe.lines, { voice: undefined, seed, design: { id: recipe.id, instruction: recipe.description }, reference: null, durationScale: null })
    joinCampaign(voiceCampaign(recipe.id), runIdOf(file))
    files.push(file)
  }
  return files
}

/** Candidate references from the takes the voice's campaign gathered with its description. */
export async function makeCandidates(recipe: Recipe, threshold: number, seconds: number, count: number): Promise<ReferenceManifest[]> {
  const files = voiceRuns(recipe.id).gathered
  if (files.length === 0) throw new Error(`${recipe.id} has no takes gathered yet; run "node src/cli.ts voice gather ${recipe.id}" first`)
  const groups = embedGroups(files, await SpeakerEmbedder.open(SPEAKER_MODEL))
  if (groups.length !== 1) throw new Error(`the takes of ${recipe.id} fall into ${groups.length} groups (${groups.map((group) => group.name).join('; ')}); they were made with different models or options`)
  return writeCandidates(groups[0]!, candidateBase(recipe.id), threshold, seconds, count)
}

/** The model speaks the sentences like each candidate of the voice, one run for each seed. */
export async function tryCandidates(recipe: Recipe, locale: string, model: TtsModel, sentences: readonly Prompt[], seeds: readonly number[]): Promise<string[]> {
  const candidates = candidatesOf(recipe.id)
  if (candidates.length === 0) throw new Error(`${recipe.id} has no candidates yet; run "node src/cli.ts voice candidates ${recipe.id}" first`)
  const files: string[] = []
  for (const name of candidates) {
    const reference = await loadReference(name)
    for (const seed of seeds) {
      process.stderr.write(`${model.id} like ${name} with seed ${seed} speaking ${sentences.length} sentences\n`)
      const file = await runTts(model, locale, sentences, { voice: undefined, seed, design: null, reference, durationScale: null })
      joinCampaign(voiceCampaign(recipe.id), runIdOf(file))
      files.push(file)
    }
  }
  return files
}

/** Keeps the chosen candidate as the voice's reference and records the choice in the recipes. */
export async function chooseCandidate(recipe: Recipe, locale: string, candidate: string, recipesFile?: string): Promise<void> {
  const kept = await copyReference(candidate, voiceReference(recipe.id))
  recordChoice(locale, recipe.id, { reference: kept.name, candidate, sha256: kept.sha256 }, recipesFile)
}
