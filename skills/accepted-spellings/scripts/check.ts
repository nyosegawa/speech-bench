import { draftErrors, readDraft, readItems } from '../../../src/spellings/draft.ts'
import { parseAnnotated } from '../../../src/spellings/notation.ts'

// Checks that every sentence of the items has a right line in the draft, and prints what the draft holds.
const [itemsFile, draftFile] = process.argv.slice(2)
if (!itemsFile || !draftFile) throw new Error('usage: node check.ts items.jsonl spellings.jsonl')
const items = readItems(itemsFile)
const drafted = readDraft(draftFile)
const errors = draftErrors(items, drafted, 0, items.length)
const segments = [...drafted.values()].flatMap((draft) => parseAnnotated(draft.line).segments)
const readings = segments.flatMap((segment) => segment.pieces).filter((piece) => piece.readings.length > 0).length
const bracketed = segments.filter((segment) => segment.bracketed)
console.log(`${drafted.size} of ${items.length} sentences annotated: ${readings} readings, ${bracketed.length} stretches with other spellings (${bracketed.reduce((sum, segment) => sum + segment.spellings.length, 0)} spellings, ${bracketed.filter((segment) => segment.optional).length} that may be left out).`)
if (errors.length > 0) {
  console.log(`\n${errors.length} error${errors.length === 1 ? '' : 's'}:`)
  for (const error of errors.slice(0, 50)) console.log(`  ${error}`)
  process.exitCode = 1
} else {
  console.log('No errors.')
}
