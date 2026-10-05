import { check, parseJsonLines, upgrade } from '../../core/stored.ts'
import { RECORDING_MANIFEST_FORMAT, recordingEntry, type RecordingEntry } from './format.ts'
import { recordingManifestUpgrades, splitHeader } from './upgrades/index.ts'

/** The entries of a recording manifest in the current form, refused with the file, the line and the field named when one does not fit. */
export function parseRecordingManifest(text: string, place: string): RecordingEntry[] {
  const { version, entries, firstEntryLine } = splitHeader(parseJsonLines(text, place))
  return upgrade(recordingManifestUpgrades, entries, version, place).map((entry, index) => check(recordingEntry, entry, `${place} line ${firstEntryLine + index}`))
}

/** The text of a recording manifest: a first line with its format, then one line an entry. */
export const recordingManifestText = (entries: readonly RecordingEntry[]): string =>
  [{ format: RECORDING_MANIFEST_FORMAT }, ...entries].map((line) => JSON.stringify(line)).join('\n') + '\n'
