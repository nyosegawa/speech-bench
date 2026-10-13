import type { Step } from '../../../core/stored.ts'
import type { ResultLines } from './index.ts'

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A machine with each GPU named alone given no driver, and no power recorded. */
function upgradeMachine(machine: Raw): Raw {
  const gpus = Array.isArray(machine.gpus) ? machine.gpus.map((name: unknown) => (typeof name === 'string' ? { name, driver: null } : name)) : machine.gpus
  return { ...machine, gpus, power: null }
}

/**
 * Format 16 records each GPU with its driver's version, where format 15 named it alone, and a Mac's power source and
 * Low Power Mode, which no run before it recorded; it also adds the GPUs' power and the machine's load, which a run
 * line of format 15 does not have and the current form reads as not recorded.
 */
export const v15ToV16: Step<ResultLines> = {
  upgrade: ([run, ...records]) => [isObject(run) && isObject(run.machine) ? { ...run, machine: upgradeMachine(run.machine) } : run!, ...records]
}
