import fs from 'node:fs'
import path from 'node:path'
import { isSafeName } from './recordings.ts'

/**
 * A sentence to be said, with the kind of utterance it stands for in a conversation with an assistant (a short
 * answer, a request, a long one): read aloud on the recording page, or spoken by a model when synthesis is
 * measured.
 */
export interface Prompt {
  id: string
  kind: string
  text: string
}

/** What a list of prompts is for: the recording page, or the sentences a synthesis model speaks. */
export type PromptUse = 'record' | 'speak'

const PROMPTS = path.join(import.meta.dirname, '..', '..', 'prompts')

/** The prompts that ship with the bench, `prompts/<use>-<locale>.json`. */
export const promptsFile = (use: PromptUse, locale: string): string => path.join(PROMPTS, `${use}-${locale}.json`)

/** The locales the bench has prompts of one use for. */
export const promptLocales = (use: PromptUse): string[] =>
  fs.readdirSync(PROMPTS).flatMap((file) => (file.startsWith(`${use}-`) && file.endsWith('.json') ? [file.slice(use.length + 1, -'.json'.length)] : [])).sort()

export function parsePrompts(text: string, locale: string): Prompt[] {
  const parsed = JSON.parse(text) as { locale?: unknown; prompts?: unknown }
  if (parsed.locale !== locale) throw new Error(`the prompts are for ${String(parsed.locale)}, not ${locale}`)
  if (!Array.isArray(parsed.prompts)) throw new Error('the prompts file needs a prompts array')
  const seen = new Set<string>()
  return parsed.prompts.map((raw: { id?: unknown; kind?: unknown; text?: unknown }, index) => {
    if (typeof raw.id !== 'string' || typeof raw.kind !== 'string' || typeof raw.text !== 'string') throw new Error(`prompt ${index + 1} needs the strings id, kind and text`)
    if (!isSafeName(raw.id)) throw new Error(`prompt id ${JSON.stringify(raw.id)} is not lower-case letters, digits, - and _`)
    if (seen.has(raw.id)) throw new Error(`prompt id ${raw.id} appears twice`)
    seen.add(raw.id)
    return { id: raw.id, kind: raw.kind, text: raw.text }
  })
}

export function loadPrompts(use: PromptUse, locale: string, file = promptsFile(use, locale)): Prompt[] {
  if (!fs.existsSync(file)) throw new Error(`no prompts for ${locale}: ${file} does not exist`)
  return parsePrompts(fs.readFileSync(file, 'utf8'), locale)
}
