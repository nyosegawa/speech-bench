import type { Upgrades } from '../../../core/stored.ts'

/**
 * The steps from the earliest reference manifest format this build reads, 1, each in a file `vNN-to-vMM.ts` that
 * imports nothing of the current form.
 */
export const referenceManifestUpgrades: Upgrades<Record<string, unknown>> = {
  name: 'reference manifest format',
  earliest: 1,
  steps: []
}

/** The version of a reference manifest: its `format`, which manifests written before they carried one lack, being of format 1. */
export const referenceManifestVersion = (raw: Record<string, unknown>): unknown => ('format' in raw ? raw.format : 1)
