import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { recordingManifestText, parseRecordingManifest } from '../src/datasets/recording-manifest/file.ts'
import { referenceManifestText, parseReferenceManifest } from '../src/make/reference-manifest/file.ts'
import { campaignText, parseCampaign } from '../src/measure/campaign-file/file.ts'
import { parseResultFile, resultText } from '../src/measure/result-file/file.ts'

/** Reads a sample in the current form, writes it and reads what was written. */
const roundTrip = <T>(parse: (text: string, place: string) => T, write: (value: T) => string) => (text: string, place: string): { read: T; again: T } => {
  const read = parse(text, place)
  return { read, again: parse(write(read), place) }
}

/** Each kind of stored record by the folder of its samples. */
const kinds: Record<string, (text: string, place: string) => { read: unknown; again: unknown }> = {
  'result-file': roundTrip(parseResultFile, resultText),
  'campaign-file': roundTrip(parseCampaign, campaignText),
  'reference-manifest': roundTrip(parseReferenceManifest, referenceManifestText),
  'recording-manifest': roundTrip(parseRecordingManifest, recordingManifestText)
}

const fixtures = path.join(import.meta.dirname, 'fixtures')

describe('every sample of a stored form', () => {
  for (const [kind, readAndWrite] of Object.entries(kinds)) {
    for (const sample of fs.readdirSync(path.join(fixtures, kind)).filter((name) => /^v\d+(-[a-z0-9-]+)?\.jsonl?$/.test(name))) {
      it(`reads ${kind}/${sample} as the current form, and reads back what it writes the same`, () => {
        const { read, again } = readAndWrite(fs.readFileSync(path.join(fixtures, kind, sample), 'utf8'), sample)
        expect(again).toEqual(read)
      })
    }
  }
})
