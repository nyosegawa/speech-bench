/**
 * Names for items told apart by the parts in which they differ, so that five seeds of one model read as "seed 1" to
 * "seed 5" and one model on two machines is told apart by the machine; what every item shares is said once. A part
 * that does not apply to an item is null and left out of its name.
 */
export function namesApart<T>(items: readonly T[], parts: ReadonlyArray<(item: T) => string | null>): { names: string[]; shared: string } {
  const varies = (part: (item: T) => string | null): boolean => new Set(items.map(part)).size > 1
  const naming = parts.some(varies) ? parts.filter(varies) : parts.slice(0, 1)
  const join = (values: ReadonlyArray<string | null>): string => values.filter((value) => value !== null).join(', ')
  return {
    names: items.map((item) => join(naming.map((part) => part(item)))),
    shared: items.length === 0 ? '' : join(parts.filter((part) => !naming.includes(part)).map((part) => part(items[0]!)))
  }
}
