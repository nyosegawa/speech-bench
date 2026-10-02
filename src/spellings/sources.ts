import fs from 'node:fs'
import { commonVoiceLocales, commonVoiceTestSentences } from '../datasets/common-voice.ts'
import { fleursTestSentences, fleursLocales } from '../datasets/fleurs.ts'
import { parsePrompts, promptLocales, promptsFile } from '../datasets/prompts.ts'

/** Reference sentences annotated together, whose annotations go to `spellings/<name>.jsonl`. */
export interface Source {
  name: string
  locale: string
  /** The sentences, each once, in the order the source gives them. */
  sentences: () => Promise<string[]>
}

const SOURCES: ReadonlyArray<{ prefix: string; locales: () => string[]; sentences: (locale: string) => Promise<string[]> }> = [
  { prefix: 'fleurs', locales: fleursLocales, sentences: fleursTestSentences },
  { prefix: 'common-voice-8', locales: commonVoiceLocales, sentences: commonVoiceTestSentences },
  {
    prefix: 'record',
    locales: () => promptLocales('record'),
    sentences: async (locale) => [...new Set(parsePrompts(fs.readFileSync(promptsFile('record', locale), 'utf8'), locale).map((prompt) => prompt.text))]
  }
]

/**
 * The sources of annotations: the test splits of FLEURS, `fleurs-ja-JP`, and of Common Voice 8.0, `common-voice-8-ja-JP`,
 * and the prompts read on the recording page, `record-ja-JP`.
 */
export function sourceOf(name: string): Source {
  for (const source of SOURCES) {
    if (!name.startsWith(`${source.prefix}-`)) continue
    const locale = name.slice(source.prefix.length + 1)
    if (!source.locales().includes(locale)) break
    return { name, locale, sentences: () => source.sentences(locale) }
  }
  throw new Error(`${name} is not a source of sentences; the sources are ${SOURCES.flatMap((source) => source.locales().map((locale) => `${source.prefix}-${locale}`)).join(', ')}`)
}
