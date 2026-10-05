import { check, parseJsonObject, upgrade } from '../../core/stored.ts'
import { REFERENCE_MANIFEST_FORMAT, referenceManifest, type ReferenceManifest } from './format.ts'
import { referenceManifestUpgrades, referenceManifestVersion } from './upgrades/index.ts'

/** A reference manifest in the current form, refused with the file and the field named when it does not fit. */
export function parseReferenceManifest(text: string, place: string): ReferenceManifest {
  const raw = parseJsonObject(text, place)
  return check(referenceManifest, { ...upgrade(referenceManifestUpgrades, raw, referenceManifestVersion(raw), place), format: REFERENCE_MANIFEST_FORMAT }, place)
}

export const referenceManifestText = (value: ReferenceManifest): string => `${JSON.stringify(value, null, 2)}\n`
