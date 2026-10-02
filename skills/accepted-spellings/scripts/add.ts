import fs from 'node:fs'
import { addChunk, readItems } from '../../../src/spellings/draft.ts'

// Checks a chunk of annotated lines and, only when every line is right, puts them into the draft.
const [itemsFile, draftFile, chunkFile] = process.argv.slice(2)
if (!itemsFile || !draftFile || !chunkFile) throw new Error('usage: node add.ts items.jsonl spellings.jsonl chunk.txt')
const items = readItems(itemsFile)
const { errors, added, skipped, annotated } = addChunk(items, draftFile, fs.readFileSync(chunkFile, 'utf8'))
if (errors.length > 0) {
  console.log(`Nothing was written. ${errors.length} error${errors.length === 1 ? '' : 's'}:`)
  for (const error of errors) console.log(`  ${error}`)
  process.exitCode = 1
} else {
  console.log(`Wrote ${added.length} sentence${added.length === 1 ? '' : 's'}; ${annotated} of ${items.length} are annotated.`)
}
if (skipped.length > 0) console.log(`Not annotated yet, though later sentences are: ${skipped.slice(0, 20).join(', ')}${skipped.length > 20 ? ', …' : ''}`)
