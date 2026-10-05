import type { z } from 'zod'

/**
 * A file the bench writes and later reads back as the record of something measured or chosen, which cannot be
 * made again: it carries the version of its form, and its reader brings an earlier version to the current one.
 * Each kind keeps its current form in `format.ts` and the steps from earlier forms in `upgrades/`, one step a
 * file, so that the code of the current form holds none of the history.
 */

/**
 * One step from a version of a form to the next, raw JSON in and out. A step that only adds a field is declared
 * by the fields it adds, and the check of the current form says what a missing one means; a later step that reads
 * such a field finds it missing in the files written before it was added.
 */
export type Step<Raw> = { upgrade: (raw: Raw) => Raw } | { adds: readonly string[] }

/** The steps of a form in order, from the earliest version this build reads. */
export interface Upgrades<Raw> {
  /** What the version is called in messages, such as "result format". */
  name: string
  earliest: number
  steps: ReadonlyArray<Step<Raw>>
}

export const currentVersion = <Raw>(upgrades: Upgrades<Raw>): number => upgrades.earliest + upgrades.steps.length

/** Brings raw JSON of a version to the current form, refusing a version this build does not read. */
export function upgrade<Raw>(upgrades: Upgrades<Raw>, raw: Raw, version: unknown, place: string): Raw {
  const current = currentVersion(upgrades)
  if (typeof version !== 'number' || !Number.isInteger(version) || version < upgrades.earliest || version > current) {
    const known = upgrades.earliest === current ? `${current}` : `${upgrades.earliest} to ${current}`
    throw new Error(`${place} is of ${upgrades.name} ${String(version)}; this build reads ${upgrades.name} ${known}`)
  }
  return upgrades.steps.slice(version - upgrades.earliest).reduce((value, step) => ('upgrade' in step ? step.upgrade(value) : value), raw)
}

/** A JSON object, or an error naming where it stands. */
export function parseJsonObject(text: string, place: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`${place} is not JSON`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${place} is not a JSON object`)
  return value as Record<string, unknown>
}

/** JSON lines as objects, the blank ones left out, or an error naming the line that is not an object. */
export const parseJsonLines = (text: string, place: string): Array<Record<string, unknown>> =>
  text.split('\n').filter((line) => line.trim() !== '').map((line, index) => parseJsonObject(line, `${place} line ${index + 1}`))

/** A value checked against a form, or an error naming where it stands and each field that does not fit. */
export function check<T>(schema: z.ZodType<T>, raw: unknown, place: string): T {
  const result = schema.safeParse(raw)
  if (result.success) return result.data
  const problems = result.error.issues.map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : 'the record'}: ${issue.message}`)
  throw new Error(`${place} does not have the form this build reads (${problems.join('; ')})`)
}
