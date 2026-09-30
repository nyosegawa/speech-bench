import fs from 'node:fs'
import path from 'node:path'
import { isSafeName } from '../datasets/recordings.ts'

/**
 * One step of a session with ASIST listening. quiet asks for silence for its seconds; say asks for a
 * sentence, with its seconds the time allowed to say it; interrupt is a say that is shown only once the
 * assistant has been speaking for a while, to be said over it; noise asks for a sound ASIST must not take
 * as speech, for its seconds. note says how, in the speaker's language.
 */
export interface InputItem {
  id: string
  kind: 'quiet' | 'say' | 'interrupt' | 'noise'
  seconds: number
  text?: string
  note?: string
}

const KINDS: ReadonlyArray<InputItem['kind']> = ['quiet', 'say', 'interrupt', 'noise']

export const itemsFile = (locale: string): string => path.join(import.meta.dirname, '..', '..', 'prompts', `asist-input-${locale}.json`)

export function parseItems(text: string, locale: string): InputItem[] {
  const parsed = JSON.parse(text) as { locale?: unknown; items?: unknown }
  if (parsed.locale !== locale) throw new Error(`the items are for ${String(parsed.locale)}, not ${locale}`)
  if (!Array.isArray(parsed.items)) throw new Error('the items file needs an items array')
  const seen = new Set<string>()
  return parsed.items.map((raw: Record<string, unknown>, index) => {
    const where = `item ${index + 1}`
    if (typeof raw.id !== 'string' || !isSafeName(raw.id)) throw new Error(`${where} needs an id of lower-case letters, digits, - and _`)
    if (seen.has(raw.id)) throw new Error(`item id ${raw.id} appears twice`)
    seen.add(raw.id)
    const kind = KINDS.find((candidate) => candidate === raw.kind)
    if (!kind) throw new Error(`${where} has kind ${String(raw.kind)}, not one of ${KINDS.join(', ')}`)
    if (typeof raw.seconds !== 'number' || !(raw.seconds > 0)) throw new Error(`${where} needs seconds above 0`)
    const said = kind === 'say' || kind === 'interrupt'
    if (said !== (typeof raw.text === 'string')) throw new Error(`${where}: a ${kind} item ${said ? 'needs' : 'has no'} text`)
    if (!said && typeof raw.note !== 'string') throw new Error(`${where}: a ${kind} item needs a note saying what to do`)
    if (raw.note !== undefined && typeof raw.note !== 'string') throw new Error(`${where}: note is text`)
    return { id: raw.id, kind, seconds: raw.seconds, ...(said ? { text: raw.text as string } : {}), ...(raw.note !== undefined ? { note: raw.note as string } : {}) }
  })
}

export function loadItems(locale: string, file = itemsFile(locale)): InputItem[] {
  if (!fs.existsSync(file)) throw new Error(`no session items for ${locale}: ${file} does not exist`)
  return parseItems(fs.readFileSync(file, 'utf8'), locale)
}
