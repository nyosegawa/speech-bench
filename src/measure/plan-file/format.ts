import { z } from 'zod'
import { currentVersion } from '../../core/stored.ts'
import { planUpgrades } from './upgrades/index.ts'

/**
 * The version of the form of a measurement plan, its `format`. A change to the form, an added field included, adds a
 * step to `upgrades/` and a sample of the new version to tests/fixtures/plan-file.
 */
export const PLAN_FORMAT = currentVersion(planUpgrades)

/** What every entry of a plan takes: the models, and the builds, devices and loads each is run with. */
const entryCommon = {
  /** Catalog ids, each run in every build, device and load the entry lists. */
  models: z.array(z.string()).min(1),
  /**
   * The builds of speech.cpp its speech.cpp entries run, as SPEECH_BENCH_SPEECH_CPP names them: a pinned
   * release's tag (`v0.8.4`), a local build directory or `ci:<run id>`; null for the release the bench pins. An entry of
   * another runtime runs its pinned release once.
   */
  builds: z.array(z.string().nullable()).min(1).default([null]),
  /** The devices in ggml's names, such as `CPU`, for runtimes built on ggml; null for the GPU. */
  devices: z.array(z.string().nullable()).min(1).default([null]),
  /** Whether each run loads its model from copies no file cache holds. */
  coldLoad: z.boolean().default(false),
  /** A model file on the machine in place of the pinned file of the entry's one model, with the sha256 it must have. */
  modelFile: z.strictObject({ file: z.string(), sha256: z.string() }).nullable().default(null),
  locale: z.string()
}

/** Recognition of the first `count` utterances of a set's test split. */
const asrEntry = z.strictObject({
  ...entryCommon,
  task: z.literal('asr'),
  set: z.enum(['fleurs', 'common-voice']),
  count: z.int().positive()
})

/** Synthesis of the sentences of `prompts/speak-<locale>.json`, or those `only` names, once for each seed. */
const ttsEntry = z.strictObject({
  ...entryCommon,
  task: z.literal('tts'),
  /** The seeds of the runs, one run each; null leaves the seed to the runtime. */
  seeds: z.array(z.int().nonnegative().nullable()).min(1).default([null]),
  /** The built-in voice, or null for the one native to the locale. */
  voice: z.string().nullable().default(null),
  /** The reference voice of `references/`, for a model without built-in voices. */
  reference: z.string().nullable().default(null),
  only: z.array(z.string()).nullable().default(null)
})

/**
 * A measurement: the combinations of models, builds, devices and sets to run, and how many rounds of them. Every run
 * joins the plan's campaign, and a round runs every combination once in an order of its own.
 */
export const plan = z.strictObject({
  format: z.literal(PLAN_FORMAT),
  campaign: z.string(),
  rounds: z.int().positive(),
  entries: z.array(z.discriminatedUnion('task', [asrEntry, ttsEntry])).min(1)
})
export type Plan = z.infer<typeof plan>
export type PlanEntry = Plan['entries'][number]
