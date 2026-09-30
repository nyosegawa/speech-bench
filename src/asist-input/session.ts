import fs from 'node:fs'
import path from 'node:path'
import { isSafeName } from '../datasets/recordings.ts'
import { asistInputDir } from '../paths.ts'
import { connectToAsist } from './cdp.ts'
import type { InputItem } from './items.ts'
import { conditions, drain, install, release, takeHold, useCapture, type TapConditions, type TapFrame } from './tap.ts'

const SAMPLE_RATE = 16_000
/** How long ASIST has to be neither capturing, thinking nor speaking before the next item is shown. */
const SETTLE_SECONDS = 2.5
/** How long a kept capture may wait for the assistant to start thinking about it. */
const REPLY_START_SECONDS = 15
/** How long the assistant has to have been speaking before an interrupt is shown. */
const INTERRUPT_AFTER_SECONDS = 3
const INTERRUPT_WAIT_SECONDS = 30
/** The least time a said item stays up, so that a click before the speaker starts does not end it. */
const MIN_SAY_SECONDS = 2
/** ASIST delivers a frame every 11 to 21 ms, so a longer gap means its microphone stopped. */
const STALL_MS = 5000

/** The version of the form of a session folder, carried in session.json. */
export const SESSION_FORMAT = 1

export type Capture = 'native' | 'getusermedia'

export interface SessionOptions {
  port: number
  locale: string
  speaker: string
  /** What the speaker calls the microphone, such as builtin or airpods. */
  mic: string
  capture: Capture
  items: readonly InputItem[]
  /** Stops the session between frames; what was recorded so far stays on disk. */
  signal: AbortSignal
}

/** session.json: who spoke, into what, and how ASIST was set to hear. */
export interface SessionInfo {
  format: number
  locale: string
  speaker: string
  mic: string
  capture: Capture
  startedAt: string
  sampleRate: number
  conditions: TapConditions
}

/** An item as it went: the samples it covered, or skipped when an interrupt found no reply to speak over. */
export interface ItemRecord {
  id: string
  kind: InputItem['kind']
  text: string | null
  note: string | null
  start: number
  end: number
  skipped: boolean
}

/** A float WAVE file written as the audio arrives, with its sizes filled in on close. */
class WavWriter {
  private readonly fd: number
  private length = 0

  constructor(file: string) {
    this.fd = fs.openSync(file, 'w')
    fs.writeSync(this.fd, Buffer.alloc(44))
  }

  write(samples: Float32Array): void {
    fs.writeSync(this.fd, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
    this.length += samples.byteLength
  }

  close(): void {
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + this.length, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(3, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(SAMPLE_RATE, 24)
    header.writeUInt32LE(SAMPLE_RATE * 4, 28)
    header.writeUInt16LE(4, 32)
    header.writeUInt16LE(32, 34)
    header.write('data', 36)
    header.writeUInt32LE(this.length, 40)
    fs.writeSync(this.fd, header, 0, 44, 0)
    fs.closeSync(this.fd)
  }
}

/** What ASIST is doing, followed frame by frame, in samples of the session. */
class Timeline {
  now = 0
  capturing = false
  playing = false
  thinking = false
  playingSince: number | null = null
  /** The last sample at which ASIST was capturing, thinking or speaking. */
  busyUntil = 0
  /** The last sample at which ASIST was thinking or speaking, which is how a reply shows. */
  replyingUntil = 0
  captures: Array<{ start: number; end: number | null; outcome: TapFrame['outcome'] }> = []

  follow(frame: TapFrame): void {
    if (!frame.capturing && frame.capturingAfter) this.captures.push({ start: frame.start, end: null, outcome: null })
    if (frame.outcome) {
      const open = this.captures.at(-1)
      if (open && open.end === null) Object.assign(open, { end: frame.end, outcome: frame.outcome })
    }
    if (frame.playing && !this.playing) this.playingSince = frame.start
    if (!frame.playing) this.playingSince = null
    this.capturing = frame.capturingAfter
    this.playing = frame.playing
    this.thinking = frame.phase === 'think'
    if (this.thinking || this.playing) this.replyingUntil = frame.end
    if (this.capturing || this.thinking || this.playing) this.busyUntil = frame.end
    this.now = frame.end
  }

  get busy(): boolean {
    return this.capturing || this.thinking || this.playing
  }

  capturesSince(sample: number): Array<{ start: number; end: number | null; outcome: TapFrame['outcome'] }> {
    return this.captures.filter((capture) => capture.start >= sample)
  }
}

const seconds = (samples: number): number => samples / SAMPLE_RATE
const clearScreen = '\x1b[2J\x1b[H'

/**
 * Walks the speaker through the items while ASIST listens, and records what ASIST's VAD received: the audio,
 * the state around every frame, and the stretch each item covered. ASIST answers as it would in use, so its
 * replies, and their echo in the microphone, are part of the recording.
 */
export async function recordSession(options: SessionOptions): Promise<string> {
  if (!isSafeName(options.speaker)) throw new Error('--speaker names who speaks, in lower-case letters, digits, - and _')
  if (!isSafeName(options.mic)) throw new Error('--mic names the microphone, in lower-case letters, digits, - and _')
  const cdp = await connectToAsist(options.port)
  try {
    const { bundle } = await takeHold(cdp, options.signal)
    await useCapture(cdp, options.capture === 'native')
    const info: SessionInfo = {
      format: SESSION_FORMAT,
      locale: options.locale,
      speaker: options.speaker,
      mic: options.mic,
      capture: options.capture,
      startedAt: new Date().toISOString(),
      sampleRate: SAMPLE_RATE,
      conditions: await conditions(cdp, bundle)
    }
    const started = new Date(info.startedAt)
    const two = (value: number): string => String(value).padStart(2, '0')
    const stamp = `${started.getFullYear()}${two(started.getMonth() + 1)}${two(started.getDate())}-${two(started.getHours())}${two(started.getMinutes())}${two(started.getSeconds())}`
    const folder = path.join(asistInputDir(), options.locale, options.speaker, `${stamp}-${options.mic}-${options.capture}`)
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'session.json'), `${JSON.stringify(info, null, 2)}\n`)
    const wav = new WavWriter(path.join(folder, 'input.wav'))
    const framesFile = fs.openSync(path.join(folder, 'frames.jsonl'), 'w')
    const itemsFile = fs.openSync(path.join(folder, 'items.jsonl'), 'w')
    const timeline = new Timeline()
    let status = ''
    let lastFrameAt = Date.now()

    const tick = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      if (options.signal.aborted) throw new Error(`stopped; what was recorded is in ${folder}`)
      const { frames, audio } = await drain(cdp)
      if (frames.length === 0) {
        if (Date.now() - lastFrameAt > STALL_MS) throw new Error(`ASIST delivered no audio for ${STALL_MS / 1000} s; its microphone stopped`)
        return
      }
      lastFrameAt = Date.now()
      wav.write(audio)
      fs.writeSync(framesFile, frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n')
      for (const frame of frames) timeline.follow(frame)
      const state = timeline.capturing ? 'capturing' : timeline.playing ? 'speaking' : timeline.thinking ? 'thinking' : 'listening'
      process.stdout.write(`\r\x1b[K  ASIST: ${state}  ${status}`)
    }
    const waitUntil = async (done: () => boolean): Promise<void> => {
      while (!done()) await tick()
    }
    // Before an interrupt the wait ends as soon as the reply starts, so there is a reply to speak over.
    const settle = async (from: number, untilReply: boolean): Promise<void> => {
      const kept = timeline.capturesSince(from).filter((capture) => capture.outcome === 'kept').at(-1)
      if (kept?.end) {
        const heardAt = kept.end
        await waitUntil(() => timeline.replyingUntil > heardAt || seconds(timeline.now - heardAt) >= REPLY_START_SECONDS)
        if (untilReply) return
      }
      await waitUntil(() => !timeline.busy && seconds(timeline.now - timeline.busyUntil) >= SETTLE_SECONDS)
    }

    try {
      await install(cdp)
      await tick()
      for (const [index, item] of options.items.entries()) {
        let skipped = false
        if (item.kind === 'interrupt') {
          const waitFrom = timeline.now
          status = 'waiting for the assistant to speak'
          await waitUntil(() =>
            (timeline.playingSince !== null && seconds(timeline.now - timeline.playingSince) >= INTERRUPT_AFTER_SECONDS) ||
            seconds(timeline.now - waitFrom) >= INTERRUPT_WAIT_SECONDS)
          skipped = timeline.playingSince === null
        }
        const start = timeline.now
        process.stdout.write(`${clearScreen}[${index + 1}/${options.items.length}] ${item.kind}${skipped ? ' (skipped: the assistant was not speaking)' : ''}\n\n`)
        if (item.note) process.stdout.write(`  ${item.note}\n\n`)
        if (item.text) process.stdout.write(`    ${item.text}\n\n`)
        if (!skipped) {
          if (item.kind === 'quiet') {
            await waitUntil(() => {
              status = `${Math.max(0, Math.ceil(item.seconds - seconds(timeline.now - start)))} s`
              return seconds(timeline.now - start) >= item.seconds
            })
          } else {
            // A said item moves on once a capture that opened after it has ended, and not before the
            // speaker has had a moment to start; a noise, or a voice ASIST never hears, is given its
            // seconds.
            await waitUntil(() => {
              const heard = timeline.capturesSince(start).filter((capture) => capture.end !== null)
              const elapsed = seconds(timeline.now - start)
              status = heard.length > 0 ? `captures: ${heard.map((capture) => capture.outcome).join(', ')}` : ''
              const done = item.kind === 'noise' ? elapsed >= item.seconds : (heard.length > 0 && elapsed >= MIN_SAY_SECONDS) || elapsed >= item.seconds
              return done && !timeline.capturing
            })
            status = 'waiting for ASIST to finish'
            await settle(start, options.items[index + 1]?.kind === 'interrupt')
          }
        }
        const record: ItemRecord = { id: item.id, kind: item.kind, text: item.text ?? null, note: item.note ?? null, start, end: timeline.now, skipped }
        fs.writeSync(itemsFile, `${JSON.stringify(record)}\n`)
        status = ''
      }
    } finally {
      wav.close()
      fs.closeSync(framesFile)
      fs.closeSync(itemsFile)
    }
    process.stdout.write(`${clearScreen}Done. ASIST's microphone is off.\n`)
    return folder
  } finally {
    await release(cdp).catch((error: unknown) => console.error(`could not take the tap off ASIST: ${error instanceof Error ? error.message : error}`))
    cdp.close()
  }
}

