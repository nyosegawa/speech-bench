import path from 'node:path'
import { parseArgs } from 'node:util'
import { isSafeName } from '../datasets/recordings.ts'
import { loadPrompts } from '../datasets/prompts.ts'
import { startRecordingServer } from '../record/server.ts'
import { isLanguageTag } from '../core/language.ts'
import { recordingsDir } from '../core/paths.ts'

export async function record(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { locale: { type: 'string' }, speaker: { type: 'string' }, prompts: { type: 'string' } } })
  const locale = values.locale
  if (!locale || !isLanguageTag(locale)) throw new Error('--locale is a BCP 47 tag such as ja-JP or en-US')
  if (!values.speaker || !isSafeName(values.speaker)) throw new Error('--speaker names who records, in lower-case letters, digits, - and _')
  const prompts = loadPrompts('record', locale, values.prompts)
  const { url } = await startRecordingServer({ locale, speaker: values.speaker }, prompts)
  console.log(`Open ${url} in a browser to record ${prompts.length} prompts as ${values.speaker}. Recordings go to ${path.join(recordingsDir(), locale, values.speaker)}. Press Ctrl-C to stop.`)
}
