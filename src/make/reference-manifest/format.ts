import { z } from 'zod'
import { currentVersion } from '../../core/stored.ts'
import { referenceManifestUpgrades } from './upgrades/index.ts'

/**
 * The version of the form of a reference manifest, its `format`. A change to the form, an added field included,
 * adds a step to `upgrades/` and a sample of the new version to tests/fixtures/reference-manifest.
 */
export const REFERENCE_MANIFEST_FORMAT = currentVersion(referenceManifestUpgrades)

/** What a reference voice was made of, written beside its WAVE file. */
export const referenceManifest = z.strictObject({
  format: z.literal(REFERENCE_MANIFEST_FORMAT),
  name: z.string(),
  group: z.string(),
  /** The similarity every pair of the set held to, or null for takes named by hand. */
  threshold: z.number().nullable(),
  seconds: z.number(),
  /** The takes in the order they follow one another, each with its likeness to the first. */
  takes: z.array(z.strictObject({ audio: z.string(), label: z.string(), text: z.string(), seconds: z.number(), likenessToCenter: z.number() })),
  meanSimilarity: z.number(),
  weakestPair: z.number()
})
export type ReferenceManifest = z.infer<typeof referenceManifest>
