import { LIMITS } from '@/lib/figures.ts'
import { cn } from '@/lib/utils.ts'

/** The similarities the colors span; below and above they keep the end colors. */
const SCALE = { low: 0.2, high: 0.9 }

const shareOf = (value: number): number => Math.max(0, Math.min(1, (value - SCALE.low) / (SCALE.high - SCALE.low)))

/**
 * How alike every pair of voices is, darker for more alike and outlined in red where two voices are too alike
 * to tell apart. The diagonal is how alike each voice's own takes are. A cell plays the pair.
 */
export function SimilarityMatrix({ labels, values, onPair }: { labels: string[]; values: ReadonlyArray<ReadonlyArray<number | null>>; onPair: (a: number, b: number) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-xs tabular-nums">
        <thead>
          <tr>
            <th />
            {labels.map((label, index) => <th key={index} title={label} className="px-1 pb-1 font-medium text-muted-foreground">{index + 1}</th>)}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, row) => (
            <tr key={row}>
              <th className="max-w-56 truncate pr-2 text-left font-medium" title={label}>{row + 1} {label}</th>
              {labels.map((_, column) => {
                const value = values[row]?.[column] ?? null
                const share = value === null ? 0 : shareOf(value)
                const self = row === column
                return (
                  <td key={column} className="p-0.5">
                    <button
                      type="button"
                      disabled={self || value === null}
                      title={self ? `${label}: how alike its own takes are` : `${label} and ${labels[column]}: play the same sentence in both`}
                      onClick={() => onPair(row, column)}
                      className={cn(
                        'h-8 w-12 rounded-sm text-center disabled:cursor-default',
                        share > 0.6 ? 'text-white' : 'text-foreground',
                        self && 'ring-1 ring-foreground/40 ring-inset',
                        !self && value !== null && value >= LIMITS.alike && 'ring-2 ring-red-500 ring-inset'
                      )}
                      style={{ background: value === null ? undefined : `color-mix(in oklab, var(--heat-high) ${Math.round(share * 100)}%, var(--heat-low))` }}
                    >
                      {value === null ? '–' : value.toFixed(2)}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
