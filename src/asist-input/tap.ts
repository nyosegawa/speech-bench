import type { Cdp } from './cdp.ts'

/**
 * One frame as ASIST's VAD received it, as sample offsets into the session's audio, with the state the VAD
 * and the conversation were in: the adaptive noise floor and the boost before the frame, Silero's voice
 * probability as the VAD would read it (null while Silero is not ready), the hangover in force, whether a
 * capture was open before and after the frame, how a capture that ended at the frame ended, whether the
 * assistant's voice was playing, and the phase of the turn.
 */
export interface TapFrame {
  start: number
  end: number
  noiseFloor: number
  boost: number
  muted: boolean
  prob: number | null
  hangoverMs: number
  capturing: boolean
  capturingAfter: boolean
  outcome: 'kept' | 'dropped' | 'muted' | null
  playing: boolean
  /** The phase of the conversation the orb shows (idle, listen, think, speak), or null without an orb. */
  phase: string | null
  native: boolean
}

/** What decides how ASIST hears, read from ASIST itself when the tap is installed. */
export interface TapConditions {
  native: boolean
  /** DeepFilterNet on the native helper's audio, which getUserMedia never has. */
  noiseSuppression: boolean
  hangoverMs: number
  vapEnabled: boolean
  bargeIn: boolean
  /** The label of the input device the capture opened, or of the default input for the native helper. */
  device: string | null
  /** getUserMedia's applied settings (sample rate, echo cancellation, automatic gain and so on). */
  trackSettings: Record<string, unknown> | null
  appVersion: string
  /** The renderer bundle, whose hashed name identifies the build. */
  bundle: string
}

const HANDLE = 'globalThis.__speechBenchTap'

/**
 * Takes hold of ASIST's voice controller and speech player, which live in the renderer bundle's module
 * scope where Runtime.evaluate cannot reach. The session presses ASIST's microphone button with a
 * breakpoint in the button's handler, which pauses once; the handles are copied to a global there, and the
 * breakpoint goes. The press turns the microphone on or off, which useCapture settles afterwards.
 */
export async function takeHold(cdp: Cdp, signal: AbortSignal): Promise<{ bundle: string }> {
  const scripts: Array<{ scriptId: string; url: string }> = []
  const stopListening = cdp.on('Debugger.scriptParsed', (params) => scripts.push({ scriptId: String(params.scriptId), url: String(params.url) }))
  await cdp.send('Debugger.enable')
  stopListening()
  let found: { scriptId: string; url: string; line: number; column: number; controller: string; player: string } | null = null
  for (const script of scripts.filter((candidate) => /[/\\]assets[/\\]index-[^/\\]+\.js$/.test(candidate.url))) {
    const source = String((await cdp.send('Debugger.getScriptSource', { scriptId: script.scriptId })).scriptSource)
    const lines = source.split('\n')
    const handler = lines.findIndex((text) => text.startsWith('async function toggleMic()'))
    const controller = /const (\w+) = new VoiceController\(\);/.exec(source)?.[1]
    const player = /const (\w+) = new SpeechPlayer\(\);/.exec(source)?.[1]
    const body = lines[handler + 1] ?? ''
    if (handler >= 0 && controller && player) found = { ...script, line: handler + 1, column: body.search(/\S/), controller, player }
  }
  if (!found) throw new Error('the renderer bundle has no toggleMic, VoiceController or SpeechPlayer; ASIST\'s voice code has changed and the tap needs updating')
  const { breakpointId } = await cdp.send('Debugger.setBreakpoint', { location: { scriptId: found.scriptId, lineNumber: found.line, columnNumber: found.column } })
  let pressed: Promise<unknown> = Promise.resolve()
  try {
    const callFrameId = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('pressing ASIST\'s microphone button did not reach its handler; is ASIST in a live voice engine?')), 5000)
      const stop = cdp.on('Debugger.paused', (params) => {
        const hits = (params.hitBreakpoints as string[] | undefined) ?? []
        if (hits.includes(String(breakpointId))) finish(String((params.callFrames as Array<{ callFrameId: string }>)[0]!.callFrameId))
      })
      const onAbort = (): void => finish(new Error('stopped before ASIST was reached'))
      function finish(result: string | Error): void {
        clearTimeout(timeout)
        stop()
        signal.removeEventListener('abort', onAbort)
        if (typeof result === 'string') resolve(result)
        else reject(result)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      // The handler runs inside the click, so the evaluation that clicks answers only after the pause is
      // resumed; it is awaited then.
      pressed = cdp.evaluate(`(() => {
        const button = document.querySelector('button.mic')
        if (!button) throw new Error('ASIST shows no microphone button')
        button.click()
      })()`)
      pressed.catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))))
    })
    const response = await cdp.send('Debugger.evaluateOnCallFrame', {
      callFrameId,
      expression: `(${HANDLE} = { vc: ${found.controller}, player: ${found.player} }, typeof ${found.controller}.vad.push)`,
      returnByValue: true
    })
    if ((response.result as { value?: unknown }).value !== 'function') throw new Error('the voice controller in the paused frame has no VAD')
  } finally {
    await cdp.send('Debugger.removeBreakpoint', { breakpointId })
    await cdp.send('Debugger.resume').catch(() => {})
    await cdp.send('Debugger.disable')
  }
  await pressed
  return { bundle: found.url }
}

/**
 * Restarts ASIST's microphone on the native helper or on getUserMedia, whichever is asked for, keeping what
 * the settings chose so that release can put it back. ASIST starts getUserMedia when the helper cannot
 * start, so the capture it ended up on is checked.
 */
export async function useCapture(cdp: Cdp, native: boolean): Promise<void> {
  const running = await cdp.evaluate<boolean>(`(async () => {
    const { vc } = ${HANDLE}
    ${HANDLE}.nativeSetting ??= vc.nativeMicPreferred
    vc.nativeMicPreferred = ${native}
    vc.disable()
    await vc.enable()
    return vc.microphone.native
  })()`)
  if (running !== native) throw new Error(native ? 'ASIST could not start the native microphone helper and captures through getUserMedia; see its log' : 'ASIST still captures through the native helper')
}

export async function conditions(cdp: Cdp, bundle: string): Promise<TapConditions> {
  return {
    ...(await cdp.evaluate<Omit<TapConditions, 'bundle'>>(`(async () => {
      const { vc } = ${HANDLE}
      const track = vc.microphone.native ? null : vc.microphone.mic.stream?.getAudioTracks()[0] ?? null
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput')
      return {
        native: vc.microphone.native,
        noiseSuppression: vc.noiseSuppression,
        hangoverMs: vc.vad.hangoverMs,
        vapEnabled: vc.vapEnabled,
        bargeIn: vc.bargeIn,
        device: track ? track.label : (inputs.find((device) => device.deviceId === 'default')?.label ?? null),
        trackSettings: track ? track.getSettings() : null,
        appVersion: await window.api.appVersion()
      }
    })()`)),
    bundle
  }
}

/**
 * Wraps the VAD's push, the hangover it computes and its end of capture on the instance, so every frame is
 * queued with the state around it. ASIST's own code runs unchanged in between.
 */
export async function install(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`(() => {
    const tap = ${HANDLE}
    if (tap.restore) throw new Error('the tap is already installed')
    const { vc, player } = tap
    const vad = vc.vad
    const proto = Object.getPrototypeOf(vad)
    const events = vad.events
    const onSpeechEnd = events.onSpeechEnd
    tap.queue = []
    tap.samples = 0
    let hangover = null
    let ended = null
    vad.effectiveHangover = function () {
      const result = proto.effectiveHangover.call(this)
      hangover = result.ms
      return result
    }
    events.onSpeechEnd = (utterance) => {
      ended = utterance !== null
      onSpeechEnd?.(utterance)
    }
    vad.push = function (frame) {
      const record = {
        start: tap.samples,
        end: tap.samples + frame.length,
        noiseFloor: this.noiseFloor,
        boost: this.thresholdBoost,
        muted: this.muted,
        prob: vc.silero.currentProb(),
        capturing: this.isSpeaking,
        playing: player.isPlaying,
        phase: document.querySelector('.orb')?.getAttribute('data-phase') ?? null,
        native: vc.microphone.native
      }
      hangover = null
      ended = null
      proto.push.call(this, frame)
      record.hangoverMs = hangover ?? proto.effectiveHangover.call(this).ms
      record.capturingAfter = this.isSpeaking
      record.outcome = ended === null ? null : ended ? 'kept' : record.muted ? 'muted' : 'dropped'
      tap.samples = record.end
      tap.queue.push([record, frame.slice()])
    }
    tap.restore = () => {
      delete vad.push
      delete vad.effectiveHangover
      events.onSpeechEnd = onSpeechEnd
    }
  })()`)
}

/** The frames queued since the last drain, and their audio as one block. */
export async function drain(cdp: Cdp): Promise<{ frames: TapFrame[]; audio: Float32Array }> {
  const { frames, audio } = await cdp.evaluate<{ frames: TapFrame[]; audio: string }>(`(() => {
    const tap = ${HANDLE}
    const queue = tap.queue
    tap.queue = []
    const audio = new Float32Array(queue.reduce((sum, [, samples]) => sum + samples.length, 0))
    let offset = 0
    for (const [, samples] of queue) {
      audio.set(samples, offset)
      offset += samples.length
    }
    const bytes = new Uint8Array(audio.buffer)
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    return { frames: queue.map(([record]) => record), audio: btoa(binary) }
  })()`)
  // A decoded Buffer can sit at any offset of Node's pool, which a Float32Array view cannot start at.
  const bytes = Uint8Array.from(Buffer.from(audio, 'base64'))
  return { frames, audio: new Float32Array(bytes.buffer) }
}

/**
 * Takes the wrappers off, puts back the capture the settings chose and turns the microphone off, so that
 * ASIST is not left listening to the room after a session.
 */
export async function release(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`(() => {
    const tap = ${HANDLE}
    if (!tap) return
    tap.restore?.()
    if (tap.nativeSetting !== undefined) tap.vc.nativeMicPreferred = tap.nativeSetting
    tap.vc.disable()
    delete ${HANDLE}
  })()`)
}
