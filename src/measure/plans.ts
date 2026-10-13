import { asrModel, ttsModel } from '../catalog/models.ts'
import { localFile, withLocalFile } from '../catalog/local-file.ts'
import { commonVoiceTestSet } from '../datasets/common-voice.ts'
import { fleursTestSet } from '../datasets/fleurs.ts'
import { loadPrompts } from '../datasets/prompts.ts'
import { loadReference } from '../make/references.ts'
import { campaignRuns, joinCampaign } from './campaigns.ts'
import type { Plan, PlanEntry } from './plan-file/format.ts'
import { readResultFile } from './result-file/file.ts'
import { checkSetupFor, DEFAULT_SETUP, runAsr, TRIM_TO_VOICE, type RunSetup } from './run-asr.ts'
import { runTts } from './run-tts.ts'
import { runFile, runIdOf } from './runs.ts'

/** One run a plan asks for in every round: an entry with one model, one build, one device and, for synthesis, one seed. */
export interface Combination {
  entry: PlanEntry
  model: string
  build: string | null
  device: string | null
  seed: number | null
  /** The combination in words, which tells it apart from every other one of any plan and names it in its runs. */
  key: string
}

/**
 * Every combination of a plan, in the order its entries list them. A build applies to a speech.cpp entry alone, so a
 * model of another runtime runs once for all the builds of its entry, as the release the bench pins.
 */
export function combinationsOf(plan: Plan): Combination[] {
  return plan.entries.flatMap((entry) => entry.models.flatMap((model) => {
    const runtime = (entry.task === 'asr' ? asrModel(model) : ttsModel(model)).runtime
    const builds = runtime === 'speech.cpp' ? entry.builds : [null]
    const seeds = entry.task === 'tts' ? entry.seeds : [null]
    return builds.flatMap((build) => entry.devices.flatMap((device) => seeds.map((seed): Combination => {
      const what = entry.task === 'asr'
        ? { task: entry.task, model, build, device, coldLoad: entry.coldLoad, modelFile: entry.modelFile, locale: entry.locale, set: entry.set, count: entry.count }
        : { task: entry.task, model, build, device, coldLoad: entry.coldLoad, modelFile: entry.modelFile, locale: entry.locale, seed, voice: entry.voice, reference: entry.reference, only: entry.only }
      return { entry, model, build, device, seed, key: JSON.stringify(what) }
    })))
  }))
}

/** A 32-bit FNV-1a hash of a text, the seed of a round's order. */
function hash(text: string): number {
  let value = 0x811c9dc5
  for (const unit of Buffer.from(text, 'utf8')) value = Math.imul(value ^ unit, 0x01000193) >>> 0
  return value
}

/**
 * The combinations in the order a round runs them: shuffled by a generator seeded with the campaign and the round, so
 * that each round alternates the builds and runtimes in another order, and a plan resumed runs them in the same one.
 */
export function roundOrder(combinations: readonly Combination[], campaign: string, round: number): Combination[] {
  let state = hash(`${campaign}\n${round}`)
  // mulberry32
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const order = [...combinations]
  for (let index = order.length - 1; index > 0; index--) {
    const other = Math.floor(next() * (index + 1))
    ;[order[index], order[other]] = [order[other]!, order[index]!]
  }
  return order
}

const doneKey = (combination: string, round: number): string => `${round}\n${combination}`

/** The rounds of combinations the runs of the campaign were made for, by the plan field each records. */
export function doneOf(runs: ReadonlyArray<{ plan: { combination: string; round: number } | null }>): Set<string> {
  return new Set(runs.flatMap(({ plan }) => (plan === null ? [] : [doneKey(plan.combination, plan.round)])))
}

/** Each round's combinations in their order, with whether a run of the campaign has already made it. */
export function schedule(plan: Plan, done: ReadonlySet<string>): Array<{ round: number; combination: Combination; done: boolean }> {
  const combinations = combinationsOf(plan)
  const keys = new Set(combinations.map((combination) => combination.key))
  if (keys.size !== combinations.length) throw new Error(`the plan of ${plan.campaign} lists one combination twice; each is run once a round`)
  return Array.from({ length: plan.rounds }, (_, index) => index + 1).flatMap((round) =>
    roundOrder(combinations, plan.campaign, round).map((combination) => ({ round, combination, done: done.has(doneKey(combination.key, round)) })))
}

const modelOf = <M extends Parameters<typeof withLocalFile>[0]>(model: M, entry: PlanEntry): M =>
  entry.modelFile === null ? model : withLocalFile(model, localFile(entry.modelFile.file, entry.modelFile.sha256))

/** Refuses a plan whose combinations could not all run, before any of them does. */
export function checkPlan(plan: Plan): void {
  for (const { entry, model, build, device } of combinationsOf(plan)) {
    if (entry.modelFile !== null && entry.models.length !== 1) throw new Error(`an entry of ${plan.campaign} gives a model file in place of the file of ${entry.models.length} models; give it one model`)
    const found = entry.task === 'asr' ? asrModel(model) : ttsModel(model)
    checkSetupFor(found, { ...DEFAULT_SETUP, speechCpp: build, device })
  }
}

/** Runs one combination for a round and joins the run to the campaign. */
async function runCombination(plan: Plan, combination: Combination, round: number): Promise<void> {
  const { entry } = combination
  const setup: RunSetup = { coldLoad: entry.coldLoad, speechCpp: combination.build, device: combination.device, plan: { combination: combination.key, round } }
  let file: string
  if (entry.task === 'asr') {
    const set = entry.set === 'fleurs' ? await fleursTestSet(entry.locale, entry.count) : await commonVoiceTestSet(entry.locale, entry.count)
    file = await runAsr(modelOf(asrModel(combination.model), entry), set, TRIM_TO_VOICE, setup)
  } else {
    const all = loadPrompts('speak', entry.locale)
    const unknown = entry.only?.filter((id) => !all.some((prompt) => prompt.id === id)) ?? []
    if (unknown.length > 0) throw new Error(`the plan of ${plan.campaign} names sentences that are not in the list: ${unknown.join(', ')}`)
    const sentences = entry.only === null ? all : all.filter((prompt) => entry.only!.includes(prompt.id))
    const reference = entry.reference === null ? null : await loadReference(entry.reference)
    file = await runTts(modelOf(ttsModel(combination.model), entry), entry.locale, sentences, { voice: entry.voice ?? undefined, seed: combination.seed, design: null, reference, durationScale: null }, setup)
  }
  joinCampaign(plan.campaign, runIdOf(file))
}

/** What a combination is, in words for the terminal. */
export const describeCombination = ({ model, build, device, seed, entry }: Combination): string =>
  [model, build === null ? null : `build ${build}`, device === null ? null : `on ${device}`, seed === null ? null : `seed ${seed}`, entry.coldLoad ? 'cold load' : null].filter(Boolean).join(', ')

/**
 * Runs every combination of the plan that the campaign's runs have not made yet, round after round, each round in its
 * own order. A run that fails stops the plan; running it again goes on from there.
 */
export async function runPlan(plan: Plan): Promise<void> {
  checkPlan(plan)
  const steps = schedule(plan, doneOf(campaignRuns(plan.campaign).map((run) => readResultFile(runFile(run)).run)))
  const todo = steps.filter((step) => !step.done)
  process.stderr.write(`${plan.campaign}: ${steps.length - todo.length} of ${steps.length} runs made, ${todo.length} to make\n`)
  for (const [index, { round, combination }] of todo.entries()) {
    process.stderr.write(`round ${round}/${plan.rounds}, run ${index + 1}/${todo.length}: ${describeCombination(combination)}\n`)
    await runCombination(plan, combination, round)
  }
}
