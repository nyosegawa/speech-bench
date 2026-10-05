import { z } from 'zod'
import { currentVersion } from '../../core/stored.ts'
import { recordingManifestUpgrades } from './upgrades/index.ts'

/**
 * The version of the form of a recording manifest, `format` in its first line. A change to the form, an added
 * field included, adds a step to `upgrades/` and a sample of the new version to tests/fixtures/recording-manifest.
 */
export const RECORDING_MANIFEST_FORMAT = currentVersion(recordingManifestUpgrades)

/** One recording of a speaker: its id, its WAVE file relative to the manifest and what was said. */
export const recordingEntry = z.strictObject({ id: z.string(), audio: z.string(), text: z.string() })
export type RecordingEntry = z.infer<typeof recordingEntry>
