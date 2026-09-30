import fs from 'node:fs'
import path from 'node:path'
import { asistInputDir } from '../paths.ts'
import { ASIST_VAD, frameRms, segment, type Capture, type VadValues } from '../vad.ts'
import { readWav, type Pcm } from '../wav.ts'
import { SESSION_FORMAT, type ItemRecord, type SessionInfo } from './session.ts'
import type { TapFrame } from './tap.ts'

/** A frame counts as someone's voice when Silero's probability reaches this, as it does in ASIST. */
const VOICE_PROB = 0.5

export interface Session {
  folder: string
  info: SessionInfo
  items: ItemRecord[]
  frames: TapFrame[]
  pcm: Pcm
}

const readLines = <T>(file: string): T[] =>
  fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as T)

export function readSession(folder: string): Session {
  const info = JSON.parse(fs.readFileSync(path.join(folder, 'session.json'), 'utf8')) as SessionInfo
  if (info.format !== SESSION_FORMAT) throw new Error(`${folder} is a session of format ${info.format}; this bench reads format ${SESSION_FORMAT}`)
  const pcm = readWav(fs.readFileSync(path.join(folder, 'input.wav')))
  const frames = readLines<TapFrame>(path.join(folder, 'frames.jsonl'))
  const last = frames.at(-1)
  if (last && last.end !== pcm.samples.length) throw new Error(`${folder}: the frames cover ${last.end} samples and the audio has ${pcm.samples.length}`)
  return { folder, info, items: readLines<ItemRecord>(path.join(folder, 'items.jsonl')), frames, pcm }
}

/** Every session folder under the data folder, oldest first within each speaker. */
export function allSessionFolders(): string[] {
  const root = asistInputDir()
  if (!fs.existsSync(root)) return []
  const folders: string[] = []
  for (const locale of fs.readdirSync(root).sort()) {
    for (const speaker of fs.readdirSync(path.join(root, locale)).sort()) {
      for (const session of fs.readdirSync(path.join(root, locale, speaker)).sort()) {
        const folder = path.join(root, locale, speaker, session)
        if (fs.existsSync(path.join(folder, 'session.json'))) folders.push(folder)
      }
    }
  }
  return folders
}

export const dbfs = (rms: number): number => (rms > 0 ? 20 * Math.log10(rms) : -Infinity)

/** The value below which the given share of the values lie, by linear interpolation between ranks. */
export function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const rank = share * (sorted.length - 1)
  const below = Math.floor(rank)
  const above = Math.min(sorted.length - 1, below + 1)
  return sorted[below]! + (sorted[above]! - sorted[below]!) * (rank - below)
}

const loudestOf = (levels: readonly number[]): number => levels.reduce((loudest, level) => Math.max(loudest, level), 0)

const inside = (frame: TapFrame, item: ItemRecord): boolean => frame.start >= item.start && frame.start < item.end

/** The outcomes of the captures that opened during each item. */
function outcomesByItem(items: readonly ItemRecord[], captures: ReadonlyArray<{ opened: number; outcome: Capture['outcome'] }>): Map<string, string> {
  return new Map(items.map((item) => {
    const opened = captures.filter((capture) => capture.opened >= item.start && capture.opened < item.end)
    return [item.id, opened.length === 0 ? '-' : opened.map((capture) => capture.outcome).join('+')]
  }))
}

/** The captures ASIST itself opened and how each ended, read from the frames. */
function recordedCaptures(frames: readonly TapFrame[]): Array<{ opened: number; outcome: Capture['outcome'] }> {
  const captures: Array<{ opened: number; outcome: Capture['outcome'] }> = []
  let open: { opened: number; outcome: Capture['outcome'] } | null = null
  for (const frame of frames) {
    if (!frame.capturing && frame.capturingAfter) {
      open = { opened: frame.start, outcome: 'dropped' }
      captures.push(open)
    }
    if (frame.outcome && open) {
      open.outcome = frame.outcome
      open = null
    }
  }
  return captures
}

export interface ItemLevels {
  id: string
  kind: ItemRecord['kind']
  /** The loudest frame outside the assistant's speech. */
  loudest: number
  /** The 95th percentile of the frames Silero takes for a voice, outside the assistant's speech. */
  voiceP95: number
  voiceMs: number
}

/** The levels of each item, leaving out the frames the assistant's voice was playing in, except in an interrupt. */
export function itemLevels(session: Session): ItemLevels[] {
  const rms = session.frames.map((frame) => frameRms(session.pcm.samples, frame.start, frame.end))
  return session.items.map((item) => {
    const own = session.frames.map((frame, index) => ({ frame, level: rms[index]! })).filter(({ frame }) => inside(frame, item) && (item.kind === 'interrupt' || !frame.playing))
    const voice = own.filter(({ frame }) => frame.prob !== null && frame.prob >= VOICE_PROB)
    return {
      id: item.id,
      kind: item.kind,
      loudest: loudestOf(own.map(({ level }) => level)),
      voiceP95: percentile(voice.map(({ level }) => level), 0.95),
      voiceMs: (voice.reduce((sum, { frame }) => sum + frame.end - frame.start, 0) / session.info.sampleRate) * 1000
    }
  })
}

const fixed = (value: number, digits = 1): string => (Number.isFinite(value) ? value.toFixed(digits) : '-')
const pad = (text: string, width: number): string => text.padEnd(width)
const padStart = (text: string, width: number): string => text.padStart(width)

/**
 * One session: the room, the assistant's echo, each item's levels, what ASIST did with it, and what the VAD
 * would do with the candidate values on the same frames. A replay with ASIST's own values has to match what
 * ASIST did, which is what makes the candidate column worth reading.
 */
export function sessionReport(session: Session, candidate: VadValues): string {
  const { info, frames } = session
  const rms = frames.map((frame) => frameRms(session.pcm.samples, frame.start, frame.end))
  const quietItems = session.items.filter((item) => item.kind === 'quiet')
  const room = frames.flatMap((frame, index) => (quietItems.some((item) => inside(frame, item)) && !frame.playing && !frame.capturing ? [rms[index]!] : []))
  const floors = frames.flatMap((frame) => (quietItems.some((item) => inside(frame, item)) ? [frame.noiseFloor] : []))
  const interrupts = session.items.filter((item) => item.kind === 'interrupt')
  const echo = frames.flatMap((frame, index) => (frame.playing && !interrupts.some((item) => inside(frame, item)) ? [{ frame, level: rms[index]! }] : []))
  const recorded = recordedCaptures(frames)
  const echoCaptures = recorded.filter((capture) => {
    const frame = frames.find((candidateFrame) => candidateFrame.start === capture.opened)
    return frame?.playing && !interrupts.some((item) => capture.opened >= item.start && capture.opened < item.end)
  })
  const vadFrames = frames.map(({ start, end, prob, boost, muted, hangoverMs }) => ({ start, end, prob, boost, muted, hangoverMs }))
  const asist = outcomesByItem(session.items, recorded)
  // ASIST's VAD outlives a restart of the microphone, so its noise floor carries over into the session.
  const startFloor = frames[0]?.noiseFloor
  const replayed = outcomesByItem(session.items, segment(session.pcm, vadFrames, ASIST_VAD, startFloor))
  const tried = outcomesByItem(session.items, segment(session.pcm, vadFrames, candidate, startFloor))
  const matches = session.items.filter((item) => asist.get(item.id) === replayed.get(item.id)).length
  const conditions = info.conditions
  const capture = info.capture === 'native' ? `native helper${conditions.noiseSuppression ? ' + DeepFilterNet' : ''}` : 'getUserMedia'
  const lines = [
    `${info.speaker} · ${info.mic} · ${capture} · ${conditions.device ?? 'unknown device'} · ${info.startedAt} · ${path.basename(session.folder)}`,
    `  room ${fixed(dbfs(percentile(room, 0.1)))} dBFS (10th percentile), ASIST's noise floor ${fixed(dbfs(percentile(floors, 0.5)))} dBFS, fixed lower threshold ${fixed(dbfs(ASIST_VAD.minThreshold))} dBFS`,
    `  echo of the assistant: median ${fixed(dbfs(percentile(echo.map(({ level }) => level), 0.5)))}, 95th percentile ${fixed(dbfs(percentile(echo.map(({ level }) => level), 0.95)))}, loudest ${fixed(dbfs(loudestOf(echo.map(({ level }) => level))))} dBFS; Silero voice on ${fixed((100 * echo.filter(({ frame }) => frame.prob !== null && frame.prob >= VOICE_PROB).length) / Math.max(1, echo.length), 0)}% of it; captures it opened: ${echoCaptures.length === 0 ? 'none' : echoCaptures.map((capture) => capture.outcome).join(', ')}`,
    `  a replay with ASIST's values matches ASIST on ${matches} of ${session.items.length} items`,
    '',
    `  ${pad('item', 18)}${padStart('loudest', 9)}${padStart('voice p95', 11)}${padStart('voice ms', 10)}  ${pad('ASIST', 26)}candidate`
  ]
  for (const levels of itemLevels(session)) {
    lines.push(`  ${pad(levels.id, 18)}${padStart(fixed(dbfs(levels.loudest)), 9)}${padStart(fixed(dbfs(levels.voiceP95)), 11)}${padStart(fixed(levels.voiceMs, 0), 10)}  ${pad(asist.get(levels.id)!, 26)}${tried.get(levels.id)}`)
  }
  return lines.join('\n')
}

export function inputReport(folders: readonly string[], candidate: VadValues): string {
  const chosen = folders.length > 0 ? folders : allSessionFolders()
  if (chosen.length === 0) throw new Error(`there are no sessions under ${asistInputDir()}; record one with "node src/cli.ts asist-input"`)
  const values = Object.entries(candidate).map(([name, value]) => `${name} ${value}`).join(', ')
  return [`candidate: ${values}`, ...chosen.map((folder) => sessionReport(readSession(folder), candidate))].join('\n\n')
}
