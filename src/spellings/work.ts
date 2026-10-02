import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../core/paths.ts'
import { readDraft, readItems, lineErrors, type Item } from './draft.ts'
import { readSpellingRecords, readSpellings, sentenceKey, spellingsFile, writeSpellingRecords, type SpellingRecord } from './files.ts'
import { parseAnnotated } from './notation.ts'
import type { Source } from './sources.ts'

const REPOSITORY = path.join(import.meta.dirname, '..', '..')
/** The skill the agent annotates with. It stays out of .agents/skills, so that development sessions do not load it. */
const SKILL = path.join(REPOSITORY, 'skills', 'accepted-spellings')

/** What a work directory was made for, kept in its `work.json`. */
export interface WorkRecord {
  source: string
  /** The last commit of the skill, which the annotations record. */
  skill: string
  /** The agent, its version and model, as the annotations record them. */
  by: string
  createdAt: string
}

/** How the agent is run. */
export interface AgentSettings {
  model: string
  effort: string
}

const git = (args: readonly string[]): string => execFileSync('git', ['-C', REPOSITORY, ...args], { encoding: 'utf8', windowsHide: true }).trim()

/**
 * The commit of the skill as committed. A skill with changes not committed is refused, since the annotations name
 * the commit they were made with.
 */
function skillCommit(): string {
  const relative = path.relative(REPOSITORY, SKILL)
  if (git(['status', '--porcelain', '--', relative]) !== '') throw new Error(`${relative} has changes that are not committed; commit them first, since annotations record the commit of the skill`)
  return git(['log', '-1', '--format=%h', '--', relative])
}

function codexVersion(): string {
  try {
    return execFileSync('codex', ['--version'], { encoding: 'utf8', windowsHide: true }).trim()
  } catch {
    throw new Error('codex is not on the PATH; install the Codex CLI (npm install -g @openai/codex) to annotate')
  }
}

/**
 * A work directory in the data folder for some sentences of a source: its own git repository, so that Codex takes
 * it as the root of its work, with the skill linked into `.agents/skills`, the sentences in `items.jsonl` and what
 * it was made for in `work.json`. Node runs the skill's scripts from where the link points, in this repository.
 */
export function prepareWork(source: Source, sentences: readonly string[], part: number, record: WorkRecord): string {
  const directory = path.join(dataDir(), 'spellings', source.name, `${record.createdAt.replace(/[:.]/g, '-')}-${part}`)
  fs.mkdirSync(path.join(directory, '.agents', 'skills'), { recursive: true })
  fs.symlinkSync(SKILL, path.join(directory, '.agents', 'skills', 'accepted-spellings'), 'dir')
  const items: Item[] = sentences.map((reference) => ({ sentence: sentenceKey(reference), reference }))
  fs.writeFileSync(path.join(directory, 'items.jsonl'), items.map((item) => JSON.stringify(item)).join('\n') + '\n')
  fs.writeFileSync(path.join(directory, 'work.json'), JSON.stringify(record, null, 2) + '\n')
  execFileSync('git', ['init', '-q'], { cwd: directory, windowsHide: true })
  return directory
}

/**
 * Puts the draft of a work directory into the annotation file of its source, each line with who made it with which
 * skill when, all lines in the order of the source's `sentences`. A draft with a sentence missing or a line that
 * does not give back its sentence is refused whole. A sentence annotated already takes the new line.
 */
export function mergeWork(directory: string, sentences: readonly string[], day: string, folder?: string): { merged: number; replaced: number } {
  const work = JSON.parse(fs.readFileSync(path.join(directory, 'work.json'), 'utf8')) as WorkRecord
  const items = readItems(path.join(directory, 'items.jsonl'))
  const drafted = readDraft(path.join(directory, 'spellings.jsonl'))
  const errors = items.flatMap((item, index) => {
    const draft = drafted.get(item.sentence)
    return (draft ? lineErrors(item, draft.line) : ['has no line']).map((error) => `[${index}] ${error}`)
  })
  if (errors.length > 0) throw new Error(`${directory} cannot be merged:\n  ${errors.join('\n  ')}`)
  const file = spellingsFile(work.source, folder)
  const keyOf = (record: SpellingRecord): string => sentenceKey(parseAnnotated(record.line).reference)
  const records = new Map(readSpellingRecords(file).map((record) => [keyOf(record), record]))
  let replaced = 0
  for (const item of items) {
    const draft = drafted.get(item.sentence)!
    if (records.has(item.sentence)) replaced++
    records.set(item.sentence, { line: draft.line, ...(draft.note ? { note: draft.note } : {}), by: work.by, skill: work.skill, at: day })
  }
  const order = new Map(sentences.map((sentence, index) => [sentenceKey(sentence), index]))
  const sorted = [...records].sort(([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity)).map(([, record]) => record)
  writeSpellingRecords(file, sorted)
  return { merged: items.length, replaced }
}

const today = (): string => new Date().toISOString().slice(0, 10)

/**
 * Annotates the sentences of a source that no annotation file of its locale holds yet: up to `size` sentences in
 * each work directory, `sessions` Codex sessions at a time, each merged into `spellings/` as it ends.
 */
export async function annotate(source: Source, options: AgentSettings & { size: number; sessions: number }): Promise<void> {
  const record: WorkRecord = { source: source.name, skill: skillCommit(), by: `${codexVersion()} ${options.model} ${options.effort}`, createdAt: new Date().toISOString() }
  const sentences = await source.sentences()
  const annotated = readSpellings(source.locale)
  const pending = sentences.filter((sentence) => !annotated.has(sentenceKey(sentence)))
  if (pending.length === 0) {
    console.log(`every sentence of ${source.name} is annotated`)
    return
  }
  const parts = Array.from({ length: Math.ceil(pending.length / options.size) }, (_, part) => pending.slice(part * options.size, (part + 1) * options.size))
  const directories = parts.map((part, index) => prepareWork(source, part, index, record))
  console.log(`${pending.length} of ${sentences.length} sentences of ${source.name} to annotate in ${parts.length} work director${parts.length === 1 ? 'y' : 'ies'}, ${options.sessions} at a time`)
  const failed: string[] = []
  let next = 0
  const runOne = async (): Promise<void> => {
    while (next < directories.length) {
      const directory = directories[next++]!
      const log = path.join(directory, 'codex.log')
      const exit = await runCodex(directory, log, options)
      if (exit !== 0) {
        failed.push(`${directory}: codex exited with ${exit}; see ${log}`)
        continue
      }
      try {
        const { merged, replaced } = mergeWork(directory, sentences, today())
        console.log(`merged ${merged} sentences from ${directory}${replaced > 0 ? `, ${replaced} of them annotated before` : ''}`)
      } catch (error) {
        failed.push(error instanceof Error ? error.message : String(error))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.sessions, directories.length) }, runOne))
  if (failed.length > 0) throw new Error(`${failed.length} work director${failed.length === 1 ? 'y' : 'ies'} did not merge; fix the draft and run spellings merge on it:\n${failed.join('\n')}`)
}

function runCodex(directory: string, log: string, settings: AgentSettings): Promise<number> {
  const output = fs.openSync(log, 'w')
  const prompt = '$accepted-spellings Annotate every sentence of items.jsonl and write the annotations to spellings.jsonl.'
  const child = spawn('codex', ['exec', '-m', settings.model, '-c', `model_reasoning_effort="${settings.effort}"`, '-s', 'workspace-write', '-C', directory, prompt], { cwd: directory, stdio: ['ignore', output, output], windowsHide: true })
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => {
      fs.closeSync(output)
      resolve(code ?? 1)
    })
  })
}
