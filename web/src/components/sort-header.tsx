import { ArrowDown, ArrowUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { TableHead } from '@/components/ui/table.tsx'
import { cn } from '@/lib/utils.ts'

export interface Sort {
  key: string
  descending: boolean
}

/** A column heading that sorts the table by its column, and by the other direction when it already does. */
export function SortHeader({ column, sort, onSort, numeric = false, firstDescending = false, children }: {
  column: string
  sort: Sort
  onSort: (sort: Sort) => void
  numeric?: boolean
  firstDescending?: boolean
  children: ReactNode
}) {
  const sorted = sort.key === column
  const Arrow = sort.descending ? ArrowDown : ArrowUp
  return (
    <TableHead className={cn(numeric && 'text-right')} aria-sort={sorted ? (sort.descending ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        className={cn('inline-flex items-center gap-1 hover:text-foreground', sorted ? 'text-foreground' : 'text-muted-foreground')}
        onClick={() => onSort({ key: column, descending: sorted ? !sort.descending : firstDescending })}
      >
        {children}
        <Arrow className={cn('size-3.5', !sorted && 'invisible')} />
      </button>
    </TableHead>
  )
}

/** Compares two values of a column, numbers as numbers and text in the order of the user's language. */
export const compareValues = (a: number | string, b: number | string): number =>
  typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
