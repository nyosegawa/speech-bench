import fs from 'node:fs'
import { check, parseJsonObject, upgrade } from '../../core/stored.ts'
import { PLAN_FORMAT, plan, type Plan } from './format.ts'
import { planUpgrades } from './upgrades/index.ts'

/** A plan in the current form, refused with the file and the field named when it does not fit. */
export function parsePlan(text: string, place: string): Plan {
  const raw = parseJsonObject(text, place)
  return check(plan, { ...upgrade(planUpgrades, raw, raw.format, place), format: PLAN_FORMAT }, place)
}

export const readPlan = (file: string): Plan => parsePlan(fs.readFileSync(file, 'utf8'), file)

export const planText = (value: Plan): string => `${JSON.stringify(value, null, 2)}\n`
