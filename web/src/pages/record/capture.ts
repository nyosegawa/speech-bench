import { CLIP } from './audio.ts'

const WORKLET = `
class Collector extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel) this.port.postMessage(channel.slice(0))
    return true
  }
}
registerProcessor('collector', Collector)
`

/** The level the meter shows: the loudest sample since it was last read, and whether any sample clipped. */
export interface Meter {
  recent: number
  clipped: boolean
}

export interface Capture {
  meter: Meter
  startedAt: number
  /** Stops the microphone and returns what it captured, at the rate it captured it. */
  stop: () => Promise<{ chunks: Float32Array[]; rate: number }>
}

/**
 * Captures the microphone as it is: without echo cancellation, noise suppression or automatic gain, which would
 * change the recording a recognizer is measured on.
 */
export async function startCapture(): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  const context = new AudioContext()
  await context.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })))
  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'collector')
  const chunks: Float32Array[] = []
  const meter: Meter = { recent: 0, clipped: false }
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    chunks.push(event.data)
    for (const sample of event.data) {
      const size = Math.abs(sample)
      if (size > meter.recent) meter.recent = size
      if (size >= CLIP) meter.clipped = true
    }
  }
  source.connect(node)
  return {
    meter,
    startedAt: performance.now(),
    stop: async () => {
      stream.getTracks().forEach((track) => track.stop())
      await context.close()
      return { chunks, rate: context.sampleRate }
    }
  }
}
