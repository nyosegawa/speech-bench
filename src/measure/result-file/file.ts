import fs from 'node:fs'
import { check, parseJsonLines, upgrade } from '../../core/stored.ts'
import { RESULT_FORMAT, droppedUtterance, heardUtterance, runRecord, sentenceRecord, type ResultFile } from './format.ts'
import { resultUpgrades } from './upgrades/index.ts'

/**
 * A result file in the current form. A file of a format this build does not read and a record that does not fit
 * the form are refused, naming the file, the line and the field.
 */
export function parseResultFile(text: string, place: string): ResultFile {
  const raw = parseJsonLines(text, place)
  if (raw[0]?.type !== 'run') throw new Error(`${place} does not start with a run line`)
  const [first, ...rest] = upgrade(resultUpgrades, raw, raw[0].format, place)
  const run = check(runRecord, { ...first, format: RESULT_FORMAT }, `${place} line 1`)
  const at = (index: number): string => `${place} line ${index + 2}`
  if (run.task === 'asr') return { run, utterances: rest.map((record, index) => ('droppedBy' in record ? check(droppedUtterance, record, at(index)) : check(heardUtterance, record, at(index)))) }
  return { run, sentences: rest.map((record, index) => check(sentenceRecord, record, at(index))) }
}

export const readResultFile = (file: string): ResultFile => parseResultFile(fs.readFileSync(file, 'utf8'), file)

/** The text of a result file: its run line, then one line a record. */
export function resultText(file: ResultFile): string {
  return [file.run, ...('utterances' in file ? file.utterances : file.sentences)].map((record) => JSON.stringify(record)).join('\n') + '\n'
}
