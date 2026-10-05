import type { Upgrades } from '../../../core/stored.ts'

/**
 * The steps from the earliest recording manifest format this build reads, 1, each in a file `vNN-to-vMM.ts` that
 * imports nothing of the current form. A step takes and gives the entries, one object a line after the header.
 */
export const recordingManifestUpgrades: Upgrades<Array<Record<string, unknown>>> = {
  name: 'recording manifest format',
  earliest: 1,
  steps: []
}

/** The version of a recording manifest, `format` in a first line of its own, and the lines of its entries after it. */
export function splitHeader(lines: Array<Record<string, unknown>>): { version: unknown; entries: Array<Record<string, unknown>>; firstEntryLine: number } {
  const [first, ...entries] = lines
  return { version: first?.format, entries, firstEntryLine: 2 }
}
