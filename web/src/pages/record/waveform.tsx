import { useEffect, useRef } from 'react'
import type { Take } from './audio.ts'

/**
 * The saved recording's wave, drawn at the height of its own loudest sample so that a quiet recording still shows
 * its shape (the level is in the numbers beside it), with the part played so far in the foreground color. A click
 * plays from there.
 */
export function Waveform({ take, played, onSeek }: { take: Take; played: number; onSeek: (share: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const scale = window.devicePixelRatio || 1
    element.width = Math.round(element.clientWidth * scale)
    element.height = Math.round(element.clientHeight * scale)
    const context = element.getContext('2d')!
    const style = getComputedStyle(element)
    const [wave, done] = [style.getPropertyValue('--wave'), style.getPropertyValue('--played')]
    const { samples } = take
    const middle = element.height / 2
    const gain = (middle * 0.95) / Math.max(10 ** (take.peakDb / 20), 1e-4)
    context.clearRect(0, 0, element.width, element.height)
    for (let x = 0; x < element.width; x++) {
      const from = Math.floor((x / element.width) * samples.length)
      const to = Math.max(from + 1, Math.floor(((x + 1) / element.width) * samples.length))
      let low = 0
      let high = 0
      for (let i = from; i < to; i++) {
        low = Math.min(low, samples[i]!)
        high = Math.max(high, samples[i]!)
      }
      context.fillStyle = x / element.width < played ? done : wave
      context.fillRect(x, middle - high * gain, 1, Math.max(1, (high - low) * gain))
    }
  }, [take, played])
  return (
    <canvas
      ref={canvas}
      className="h-24 w-full cursor-pointer rounded-md bg-muted/50 [--played:var(--foreground)] [--wave:var(--muted-foreground)]"
      onClick={(event) => onSeek(event.nativeEvent.offsetX / event.currentTarget.clientWidth)}
    />
  )
}
