import fs from 'node:fs'
import path from 'node:path'
import type { Prompt } from '../datasets/prompts.ts'
import { isSafeName } from '../datasets/recordings.ts'

/**
 * A voice described in words, for a synthesis model without built-in voices that takes a description
 * (Irodori-TTS's `instruction`): the same description for every sentence is meant to keep one voice.
 */
export interface VoiceDesign {
  id: string
  instruction: string
}

/** The reference chosen for a voice: the reference voice made of it, the candidate it was copied from and its sha256. */
export interface Choice {
  reference: string
  candidate: string
  sha256: string
}

/**
 * How a voice is made: its description, the lines it says in character to gather takes of it, and the
 * reference chosen once its candidates were heard. A recipe without lines only describes a voice.
 */
export interface Recipe {
  id: string
  description: string
  lines: Prompt[]
  chosen: Choice | null
}

const PROMPTS = path.join(import.meta.dirname, '..', '..', 'prompts')

/** The recipes that ship with the bench, `prompts/voices-<locale>.json`. */
export const recipesFile = (locale: string): string => path.join(PROMPTS, `voices-${locale}.json`)

/** The locales the bench has recipes for. */
export const recipeLocales = (): string[] => fs.readdirSync(PROMPTS).flatMap((file) => /^voices-(.+)\.json$/.exec(file)?.[1] ?? []).sort()

const isString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

export function parseRecipes(text: string, locale: string): Recipe[] {
  const parsed = JSON.parse(text) as { locale?: unknown; voices?: unknown }
  if (parsed.locale !== locale) throw new Error(`the voices are for ${String(parsed.locale)}, not ${locale}`)
  if (!Array.isArray(parsed.voices)) throw new Error('the voices file needs a voices array')
  const seen = new Set<string>()
  return parsed.voices.map((raw: { id?: unknown; description?: unknown; lines?: unknown; chosen?: unknown }, index) => {
    if (!isString(raw.id) || !isString(raw.description)) throw new Error(`voice ${index + 1} needs the strings id and description`)
    if (!isSafeName(raw.id)) throw new Error(`voice id ${JSON.stringify(raw.id)} is not lower-case letters, digits, - and _`)
    if (seen.has(raw.id)) throw new Error(`voice id ${raw.id} appears twice`)
    seen.add(raw.id)
    const lines = (raw.lines ?? []) as Array<{ id?: unknown; kind?: unknown; text?: unknown }>
    if (!Array.isArray(lines)) throw new Error(`the lines of ${raw.id} are not an array`)
    const lineIds = new Set<string>()
    const parsedLines = lines.map((line, at) => {
      if (!isString(line.id) || !isString(line.kind) || !isString(line.text)) throw new Error(`line ${at + 1} of ${raw.id} needs the strings id, kind and text`)
      if (!isSafeName(line.id) || lineIds.has(line.id)) throw new Error(`line id ${JSON.stringify(line.id)} of ${raw.id} is not a safe file name used once`)
      lineIds.add(line.id)
      return { id: line.id, kind: line.kind, text: line.text }
    })
    const chosen = raw.chosen as Partial<Choice> | undefined
    if (chosen !== undefined && !(isString(chosen.reference) && isString(chosen.candidate) && /^[0-9a-f]{64}$/.test(chosen.sha256 ?? ''))) throw new Error(`the choice of ${raw.id} needs a reference, a candidate and a sha256`)
    return { id: raw.id, description: raw.description.trim(), lines: parsedLines, chosen: (chosen as Choice | undefined) ?? null }
  })
}

export function loadRecipes(locale: string, file = recipesFile(locale)): Recipe[] {
  if (!fs.existsSync(file)) throw new Error(`no voices for ${locale}: ${file} does not exist`)
  return parseRecipes(fs.readFileSync(file, 'utf8'), locale)
}

export function recipeOf(locale: string, id: string, file = recipesFile(locale)): Recipe {
  const recipes = loadRecipes(locale, file)
  const recipe = recipes.find((candidate) => candidate.id === id)
  if (!recipe) throw new Error(`there is no voice ${id} in ${file}; the voices are ${recipes.map((candidate) => candidate.id).join(', ')}`)
  return recipe
}

/** The descriptions of the voices the ids name, in the order named. */
export const loadDesigns = (locale: string, ids: readonly string[], file = recipesFile(locale)): VoiceDesign[] =>
  ids.map((id) => ({ id, instruction: recipeOf(locale, id, file).description }))

/** The recipes as the file keeps them: one line per line of a voice, so that a change shows as one line. */
export function formatRecipes(locale: string, recipes: readonly Recipe[]): string {
  const voices = recipes.map((recipe) => {
    const fields = [`      "id": ${JSON.stringify(recipe.id)}`, `      "description": ${JSON.stringify(recipe.description)}`]
    if (recipe.lines.length > 0) fields.push(`      "lines": [\n${recipe.lines.map((line) => `        ${JSON.stringify(line)}`).join(',\n')}\n      ]`)
    if (recipe.chosen) fields.push(`      "chosen": ${JSON.stringify(recipe.chosen)}`)
    return `    {\n${fields.join(',\n')}\n    }`
  })
  return `{\n  "locale": ${JSON.stringify(locale)},\n  "voices": [\n${voices.join(',\n')}\n  ]\n}\n`
}

/** Writes the choice of a voice into its recipe, leaving the other voices as they are. */
export function recordChoice(locale: string, id: string, chosen: Choice, file = recipesFile(locale)): void {
  const recipes = loadRecipes(locale, file)
  if (!recipes.some((recipe) => recipe.id === id)) throw new Error(`there is no voice ${id} in ${file}`)
  fs.writeFileSync(file, formatRecipes(locale, recipes.map((recipe) => (recipe.id === id ? { ...recipe, chosen } : recipe))))
}
