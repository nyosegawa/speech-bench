import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { sourceOf } from '../spellings/sources.ts'
import { annotate, mergeWork, type WorkRecord } from '../spellings/work.ts'

export async function spellings(args: string[]): Promise<void> {
  const [action, ...rest] = args
  if (action === 'annotate') {
    const { values } = parseArgs({
      args: rest,
      options: { source: { type: 'string' }, size: { type: 'string', default: '1000' }, sessions: { type: 'string', default: '4' }, model: { type: 'string', default: 'gpt-6.1-sol' }, effort: { type: 'string', default: 'medium' } }
    })
    if (!values.source) throw new Error('--source names the sentences to annotate, such as fleurs-ja-JP or record-ja-JP')
    const size = Number(values.size)
    const sessions = Number(values.sessions)
    if (!Number.isInteger(size) || size < 1) throw new Error('--size is the whole number of sentences in one work directory')
    if (!Number.isInteger(sessions) || sessions < 1) throw new Error('--sessions is the whole number of Codex sessions run at a time')
    await annotate(sourceOf(values.source), { size, sessions, model: values.model, effort: values.effort })
  } else if (action === 'merge') {
    const { positionals } = parseArgs({ args: rest, allowPositionals: true })
    if (positionals.length === 0) throw new Error('name the work directories to merge')
    for (const directory of positionals) {
      const work = JSON.parse(fs.readFileSync(path.join(directory, 'work.json'), 'utf8')) as WorkRecord
      const { merged, replaced } = mergeWork(directory, await sourceOf(work.source).sentences(), new Date().toISOString().slice(0, 10))
      console.log(`merged ${merged} sentences from ${directory}${replaced > 0 ? `, ${replaced} of them annotated before` : ''}`)
    }
  } else {
    throw new Error('spellings annotate --source <source> [--size 1000] [--sessions 4] [--model gpt-6.1-sol] [--effort medium], or spellings merge <work directory> ...')
  }
}
