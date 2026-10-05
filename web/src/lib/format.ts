import type { RunRow } from '@/lib/api.ts'

export const percent = (rate: number): string => `${(rate * 100).toFixed(1)}%`

export const seconds = (value: number, digits = 2): string => `${value.toFixed(digits)} s`

export const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

export type TtsRow = Extract<RunRow, { sentences: number }>
export type AsrRow = Extract<RunRow, { utterances: number }>

export const isTts = (row: RunRow): row is TtsRow => row.run.task === 'tts'

/** How a synthesis run was asked to speak: its built-in voice, description or reference, length factor and seed. */
export function voiceOf(row: TtsRow): string {
  const { voice, design, reference, durationScale, seed } = row.run
  return [voice, design?.id ?? null, reference ? `like ${reference.name}` : null, durationScale === null ? null : `length ×${durationScale}`, seed === null ? null : `seed ${seed}`]
    .filter((part) => part !== null)
    .join(', ')
}

/** How the audio of a recognition run was prepared before the model heard it. */
export function preparationOf(row: AsrRow): string {
  const { audio } = row.run
  if (audio.edges === 'voice') return `trimmed to voice (${audio.detector})`
  if (audio.edges === 'as-recorded') return `as recorded, ${audio.trailingSilence} s of silence after`
  return 'cut by an energy VAD'
}

export const machineOf = (row: RunRow): string => `${row.run.machine.hostname} · ${row.run.machine.gpus.join(' + ')}`
