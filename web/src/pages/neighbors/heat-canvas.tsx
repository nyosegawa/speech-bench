import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

/**
 * The color scale, the same for every group so that groups compare by eye: from below two different men's
 * recordings (0.33) at the light end to one speaker's recordings and beyond (0.9) at the dark end.
 */
const SCALE = { low: 0.2, high: 0.9 }

const dark = window.matchMedia('(prefers-color-scheme: dark)')
const subscribe = (onChange: () => void): (() => void) => {
  dark.addEventListener('change', onChange)
  return () => dark.removeEventListener('change', onChange)
}

const rgbOf = (hex: string): number[] => (hex.trim().match(/[0-9a-f]{2}/gi) ?? []).map((pair) => parseInt(pair, 16))

/**
 * How alike every two takes are, a cell each, in the group's order, so that one voice shows as a dark block along
 * the diagonal. The selected take's row and column are outlined; a cell selects its row's take and plays the pair.
 */
export function HeatCanvas({ similarity, labels, selected, onCell }: { similarity: number[][]; labels: string[]; selected: number; onCell: (row: number, column: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<{ row: number; column: number } | null>(null)
  const isDark = useSyncExternalStore(subscribe, () => dark.matches)
  const n = similarity.length
  const cell = Math.max(4, Math.min(16, Math.floor(640 / n)))

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const style = getComputedStyle(document.documentElement)
    const [low, high] = [rgbOf(style.getPropertyValue('--heat-low')), rgbOf(style.getPropertyValue('--heat-high'))]
    const scale = window.devicePixelRatio || 1
    element.width = n * cell * scale
    element.height = n * cell * scale
    const context = element.getContext('2d')!
    context.scale(scale, scale)
    similarity.forEach((row, i) => row.forEach((value, j) => {
      const share = Math.max(0, Math.min(1, (value - SCALE.low) / (SCALE.high - SCALE.low)))
      context.fillStyle = `rgb(${low.map((channel, index) => Math.round(channel + (high[index]! - channel) * share)).join(',')})`
      context.fillRect(j * cell, i * cell, cell, cell)
    }))
    context.strokeStyle = style.getPropertyValue('--destructive')
    context.lineWidth = 2
    context.strokeRect(0, selected * cell, n * cell, cell)
    context.strokeRect(selected * cell, 0, cell, n * cell)
  }, [similarity, selected, cell, n, isDark])

  const cellAt = (event: React.MouseEvent<HTMLCanvasElement>): { row: number; column: number } | null => {
    const box = event.currentTarget.getBoundingClientRect()
    const row = Math.floor((event.clientY - box.top) / cell)
    const column = Math.floor((event.clientX - box.left) / cell)
    return row >= 0 && column >= 0 && row < n && column < n ? { row, column } : null
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvas}
        className="cursor-pointer"
        style={{ width: n * cell, height: n * cell }}
        onMouseMove={(event) => setHover(cellAt(event))}
        onMouseLeave={() => setHover(null)}
        onClick={(event) => {
          const at = cellAt(event)
          if (at) onCell(at.row, at.column)
        }}
      />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{SCALE.low.toFixed(2)} or less</span>
        <span className="h-2 w-32 rounded-full bg-linear-to-r from-(--heat-low) to-(--heat-high)" />
        <span>{SCALE.high.toFixed(2)} or more</span>
      </div>
      <div className="min-h-5 text-xs text-muted-foreground">
        {hover && `${labels[hover.row]} ↔ ${labels[hover.column]}: ${similarity[hover.row]![hover.column]!.toFixed(2)}`}
      </div>
    </div>
  )
}
