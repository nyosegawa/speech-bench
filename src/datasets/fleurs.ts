import fs from 'node:fs'
import path from 'node:path'
import { extractArchive } from '../catalog/download.ts'
import { dataDir } from '../core/paths.ts'
import { ensurePinned, type PinnedFile } from '../catalog/store.ts'
import type { UtteranceSet } from './item.ts'

/**
 * FLEURS (google/fleurs, CC-BY-4.0): read sentences from Wikipedia in 102 languages, 16 kHz. Its es_419 is
 * Latin American Spanish (es-419) and its pt_br Brazilian Portuguese (pt-BR).
 */
const FLEURS = { repo: 'google/fleurs', revision: '70bb2e84b976b7e960aa89f1c648e09c59f894dd' }

interface FleursSplit {
  config: string
  tsv: PinnedFile
  audio: PinnedFile
}

const dataset = (file: string, bytes: number, sha256: string): PinnedFile => ({ kind: 'dataset', ...FLEURS, file, bytes, sha256 })

/**
 * The test split of each locale. FLEURS has no Spanish of Spain: its only Spanish is es_419, which is
 * not offered for es-ES because the accents differ.
 */
const split = (config: string, tsvBytes: number, tsvSha256: string, audioBytes: number, audioSha256: string): FleursSplit => ({
  config,
  tsv: dataset(`data/${config}/test.tsv`, tsvBytes, tsvSha256),
  audio: dataset(`data/${config}/audio/test.tar.gz`, audioBytes, audioSha256)
})

const TEST_SPLITS: Readonly<Record<string, FleursSplit>> = {
  'ja-JP': split('ja_jp', 361_174, '5dd9643511437414681ad3f23508596c621cdf78978724a09f1f06fefe9d300b', 448_762_391, '5de465fa7aaafc4e2c13aba44771550b8cd2dd29bb9b265daeb6d92ca8e0c136'),
  'en-US': split('en_us', 367_864, '74c046239374deeb60fa63f258f907388093a32bcaa3140965f70ef05c79f7ca', 289_851_356, 'd9c2e37b41aacd41bc283554a0a82b5476b36887049774ecb2819dcaaa55a356'),
  'fr-FR': split('fr_fr', 456_972, '5d06d338b242e00786fcf12c4c92008b9f399d5a5c872c91dca90572e7869c0d', 349_036_055, 'd23690e102f373554d1b544cd2ff1e76e4fedeb04953c0b72751a1b7c518cfdd'),
  'de-DE': split('de_de', 559_542, '82fab72c58a347345675c238f2492bb997105a4ab45d69e2a2b34ed29082fa97', 568_734_559, 'e86b42dfcdef749926cd92135045f87c25966c09e50d01c401adb04ee7d8628f'),
  'hi-IN': split('hi_in', 473_366, '889e82e2875490f9533ff59ab67326fcfa01cf828fc4412758aaaa1f442a729f', 249_331_325, '47c238b9cf7016ba596639bb3038b0c89dc6e85759f16d09c4f58c6dfa25c65f'),
  'id-ID': split('id_id', 408_796, '824cad6367283d95f545911eec051c488c182baa13a63227c6330af3c8f80741', 451_704_157, 'bf7e7f608f8834012d7f79a583b6b0dd5bb82e74e2f5fb6336fc99d3af7ffcf8'),
  'it-IT': split('it_it', 561_609, 'af1a6d7295547d283441e2ea2e6f24f41d9b26098b47fe3d588930cd053c7b08', 657_731_057, '97dbaedbfa52f4fa4a7b380be90b343066330b8526e1a88f5ab9f82f71f1758e'),
  'ko-KR': split('ko_kr', 211_844, 'cf2f7c8765f6203e3c46ef620d5e936d3f331b6e8865455557777dd1347517f5', 214_425_558, '3489e529f2aad18d3357b746c5f955941d258b79dc60d8a102d5bced2a223184'),
  'pt-BR': split('pt_br', 563_257, '4a7b8ae8ce07c355dcd2cf087a6486c7c3ab931d751b9a9218a9ee0cd798964b', 621_291_324, '968d1b68a90132ca1f044f664866418b0db0351a93601a671d5637016da4f49b'),
  'es-419': split('es_419', 599_882, 'd107a93a4f54a18ac25cd470bb4cdadce14fb075b0c1d1542258e274d209ec09', 582_112_372, '981802f6c828fd214fcf8bfc1036d80c9184b6eeb5650b3f7882f8affec046c9')
}

export const fleursLocales = (): string[] => Object.keys(TEST_SPLITS)

/** One row of a FLEURS TSV: the id is shared by the recordings of one sentence by different speakers. */
export interface FleursRow {
  sentenceId: string
  file: string
  transcription: string
}

/** Columns: id, file name, raw transcription, normalized transcription, characters, samples, gender. */
export function parseFleursTsv(text: string): FleursRow[] {
  return text.split('\n').filter((line) => line.trim() !== '').map((line, index) => {
    const [sentenceId, file, transcription] = line.split('\t')
    if (!sentenceId || !file || transcription === undefined) throw new Error(`FLEURS TSV line ${index + 1} has fewer than 3 columns`)
    return { sentenceId, file, transcription }
  })
}

/**
 * The first `count` recordings of the test split in the order of its TSV, which is fixed by the pinned
 * revision, so every machine measures the same utterances. Only those recordings are unpacked.
 */
export async function fleursTestSet(locale: string, count: number): Promise<UtteranceSet> {
  const split = TEST_SPLITS[locale]
  if (!split) throw new Error(`FLEURS is pinned for ${fleursLocales().join(', ')}, not ${locale}`)
  const rows = parseFleursTsv(fs.readFileSync(await ensurePinned(split.tsv), 'utf8')).slice(0, count)
  const folder = path.join(dataDir(), 'fleurs', FLEURS.revision, split.config)
  const audio = (row: FleursRow): string => path.join(folder, 'test', row.file)
  const missing = rows.filter((row) => !fs.existsSync(audio(row)))
  // Members of a tar archive are named with / on every system.
  if (missing.length > 0) extractArchive(await ensurePinned(split.audio), folder, missing.map((row) => `test/${row.file}`))
  return {
    name: `fleurs-${split.config}-test-${rows.length}`,
    locale,
    utterances: rows.map((row) => ({ id: row.file, audio: audio(row), reference: row.transcription }))
  }
}
