import { readDraft, readItems, showLines } from '../../../src/spellings/draft.ts'

// Prints the sentences of a range, numbered, with what is drafted for them so far.
const args = process.argv.slice(2)
const [itemsFile] = args
if (!itemsFile || itemsFile.startsWith('--')) throw new Error('usage: node show.ts items.jsonl [--from N] [--count N] [--draft spellings.jsonl]')
const option = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}
const items = readItems(itemsFile)
const from = Number(option('--from') ?? 0)
const to = Math.min(items.length, from + Number(option('--count') ?? items.length))
const draft = option('--draft')
console.log(showLines(items, draft ? readDraft(draft) : new Map(), from, to).join('\n'))
