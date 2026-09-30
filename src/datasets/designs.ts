import fs from 'node:fs'
import path from 'node:path'
import { isSafeName } from './recordings.ts'

/**
 * A voice described in words, for a synthesis model without built-in voices that takes a description
 * (Irodori-TTS's `instruction`): the same description for every sentence is meant to keep one voice.
 */
export interface VoiceDesign {
  id: string
  instruction: string
}

/** The descriptions that ship with the bench, `prompts/designs-<locale>.json`. */
export const designsFile = (locale: string): string => path.join(import.meta.dirname, '..', '..', 'prompts', `designs-${locale}.json`)

export function parseDesigns(text: string, locale: string): VoiceDesign[] {
  const parsed = JSON.parse(text) as { locale?: unknown; designs?: unknown }
  if (parsed.locale !== locale) throw new Error(`the voice designs are for ${String(parsed.locale)}, not ${locale}`)
  if (!Array.isArray(parsed.designs)) throw new Error('the voice designs file needs a designs array')
  const seen = new Set<string>()
  return parsed.designs.map((raw: { id?: unknown; instruction?: unknown }, index) => {
    if (typeof raw.id !== 'string' || typeof raw.instruction !== 'string' || raw.instruction.trim() === '') throw new Error(`voice design ${index + 1} needs the strings id and instruction`)
    if (!isSafeName(raw.id)) throw new Error(`voice design id ${JSON.stringify(raw.id)} is not lower-case letters, digits, - and _`)
    if (seen.has(raw.id)) throw new Error(`voice design id ${raw.id} appears twice`)
    seen.add(raw.id)
    return { id: raw.id, instruction: raw.instruction.trim() }
  })
}

/** The designs the ids name, in the order named; an id that is not in the file stops the run. */
export function loadDesigns(locale: string, ids: readonly string[], file = designsFile(locale)): VoiceDesign[] {
  if (!fs.existsSync(file)) throw new Error(`no voice designs for ${locale}: ${file} does not exist`)
  const designs = parseDesigns(fs.readFileSync(file, 'utf8'), locale)
  return ids.map((id) => {
    const design = designs.find((candidate) => candidate.id === id)
    if (!design) throw new Error(`there is no voice design ${id} in ${file}; the designs are ${designs.map((candidate) => candidate.id).join(', ')}`)
    return design
  })
}
