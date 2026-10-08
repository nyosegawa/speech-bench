import type { NeighborGroup } from '../analysis/neighbors.ts'
import type { Prompt } from '../datasets/prompts.ts'
import type { RecordingEntry } from '../datasets/recording-manifest/format.ts'
import type { Choice, Recipe } from '../make/recipes.ts'
import type { Campaign } from '../measure/campaign-file/format.ts'
import type { AsrSummary, TtsSummary } from '../measure/report.ts'
import type { PageData } from '../pages/listen.ts'
import type { SpellingsData } from '../pages/spellings.ts'
import type { TranscriptsData } from '../pages/transcripts.ts'
import type { VoicesPageData } from '../pages/voices.ts'

/**
 * What the web server answers, shared with the web app, which imports these types only. A route and the
 * shape it answers with change together, here.
 */

/**
 * GET /api/runs: every run with what it adds up to, the campaigns it joined, and its runtime in words as the report
 * writes it.
 */
export type RunRow = (AsrSummary | TtsSummary) & { id: string; campaigns: string[]; runtime: string }

/** GET /api/campaigns */
export type CampaignRow = Omit<Campaign, 'format'>

/** GET /api/listen?runs=a,b[&reference=name][&blind=1]: the synthesis runs named, sentence by sentence. */
export type ListenData = PageData

/** GET /api/voice-locales: the locales the bench has voice recipes for. */
export type VoiceLocales = string[]

/** GET /api/voices?locale=ja-JP: each voice's recipe and how far it has been made. */
export interface VoiceRow {
  id: string
  description: string
  lines: number
  chosen: Choice | null
  /** Runs of takes gathered from the description. */
  gathered: number
  candidates: string[]
  /** Runs in which a candidate was tried. */
  tried: number
}

/** The sentences and length factor a set of tries spoke, by which tries are compared. */
export interface TrySet {
  key: string
  set: string
  durationScale: number | null
  runs: number
  /** How many reference voices the runs spoke like. */
  references: number
}

/** GET /api/voices/<id>?locale=ja-JP[&tries=key]: a voice, its candidates and how they were heard in one set of tries. */
export interface VoiceDetail {
  locale: string
  recipe: Recipe
  /** The runs of takes gathered from the description, by id. */
  gathered: string[]
  candidates: Array<{ name: string; url: string; seconds: number; takes: number; meanSimilarity: number; weakestPair: number }>
  trySets: TrySet[]
  trySet: string | null
  tries: VoicesPageData | null
}

/** GET /api/voice-similarity?locale=ja-JP: the chosen voices, heard on the sentences the most of them were tried with. */
export interface ChosenVoices {
  trySet: string | null
  /** The voice each chosen reference belongs to, by the reference's name. */
  voiceOf: Record<string, string>
  /** Chosen voices with no tries in that set. */
  missing: string[]
  voices: VoicesPageData | null
}

/** POST /api/voices/<id>/choose with { locale, candidate }: the choice now recorded in the recipe. */
export type ChooseAnswer = Choice

/**
 * GET /api/neighbors?runs=a,b: the takes of the runs, grouped by the voice they were meant to be, with how alike every
 * two are and the largest sets that hold together.
 */
export type NeighborsData = NeighborGroup[]

/** A command of the bench the web app started, as GET /api/jobs lists it. */
export interface Job {
  id: string
  title: string
  command: string
  startedAt: string
  endedAt: string | null
  state: 'running' | 'done' | 'failed' | 'stopped'
  exitCode: number | null
  /** The file that holds the whole output. */
  log: string
  /** The last lines of the output. */
  lines: string[]
}

/** POST /api/jobs: a step of making a voice, run with the command's defaults. */
export interface VoiceStepRequest {
  step: 'gather' | 'candidates' | 'try'
  voice: string
  locale: string
}

/** GET /api/record-locales: the locales the bench has prompts to record for. */
export type RecordLocales = string[]

/** GET /api/recordings: every speaker with recordings, by locale. */
export interface SpeakerRow {
  locale: string
  speaker: string
  recordings: number
}

/** A recording with the route its audio is served at. */
export type SavedRecording = RecordingEntry & { url: string }

/** GET /api/recordings/<locale>/<speaker>: the prompts to record and the recordings so far. */
export interface RecordingSession {
  locale: string
  speaker: string
  prompts: Prompt[]
  recorded: SavedRecording[]
}

/** GET /api/transcripts?runs=a,b: recognition runs of one set, utterance by utterance. */
export type Transcripts = TranscriptsData

/** GET /api/spellings[?source=fleurs-ja-JP]: the annotations of accepted spellings of one source, the first one unless named. */
export type Spellings = SpellingsData

/** Any route that fails answers this, with a status of 400 for a request the bench cannot serve. */
export interface ApiError {
  error: string
}
