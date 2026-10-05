import { parseArgs } from 'node:util'
import { SPEAKER_MODEL, ttsModel } from '../catalog/models.ts'
import { SpeakerEmbedder } from '../engines/speaker-embedding.ts'
import { loadRecipes, recipeOf } from '../make/recipes.ts'
import { chooseCandidate, gatherTakes, makeCandidates, tryCandidates, voiceCampaign } from '../make/voice.ts'
import { loadPrompts } from '../datasets/prompts.ts'
import { isLanguageTag } from '../core/language.ts'
import { embedGroups, largestSet, similarityOf } from '../analysis/neighbors.ts'
import { writeCandidates, writeReference, type ReferenceManifest } from '../make/references.ts'
import { seedList } from './measure.ts'

/**
 * Writes a reference voice from the takes of one intended voice: the largest set in which every pair is at
 * least the threshold alike, one take per sentence, taken in order of likeness to its center up to the length.
 */
export async function reference(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { name: { type: 'string' }, threshold: { type: 'string', default: '0.8' }, seconds: { type: 'string', default: '30' }, candidates: { type: 'string' }, takes: { type: 'string' } }
  })
  if (!values.name) throw new Error('--name names the reference voice')
  const threshold = Number(values.threshold)
  const seconds = Number(values.seconds)
  if (!(threshold > 0 && threshold < 1)) throw new Error('--threshold is a similarity between 0 and 1')
  if (!(seconds > 0 && seconds <= 120)) throw new Error('--seconds is up to 120, the longest reference Irodori-TTS v4 Small takes')
  if (positionals.length === 0) throw new Error('name the result files of the takes to choose from')
  const groups = embedGroups(positionals, await SpeakerEmbedder.open(SPEAKER_MODEL))
  if (groups.length !== 1) throw new Error(`the result files hold ${groups.length} voices (${groups.map((group) => group.name).join('; ')}); name the files of one`)
  const [group] = groups
  const similarity = similarityOf(group!.takes)
  const write = (name: string, chosen: readonly number[], byHand = false): void => {
    const written = writeReference(name, group!.name, byHand ? null : threshold, chosen.map((member) => group!.takes[member]!), (a, b) => similarity[chosen[a]!]![chosen[b]!]!, byHand ? null : seconds)
    console.log(`${written.name}: ${written.takes.length} takes, ${written.seconds.toFixed(1)} s, every pair ${written.weakestPair.toFixed(2)} or more alike, ${written.meanSimilarity.toFixed(2)} on average`)
    for (const take of written.takes) console.log(`  ${take.likenessToCenter.toFixed(2)}  ${take.label}  ${take.text}`)
  }
  if (values.takes !== undefined) {
    if (values.candidates !== undefined) throw new Error('--takes names the takes of one reference; --candidates makes several from the set')
    // A take is named by its sentence and seed, sentence@seed, or by its sentence alone in a run without a seed.
    const chosen = values.takes.split(',').map((name) => {
      const [sentence, seed] = name.trim().split('@')
      const index = group!.takes.findIndex((take) => take.sentence === sentence && (seed === undefined ? take.seed === null : take.seed === Number(seed)))
      if (index < 0) throw new Error(`there is no take ${name.trim()} with enough voice among the result files`)
      return index
    })
    write(values.name, chosen, true)
    return
  }
  const sentences = group!.takes.map((take) => take.sentence)
  if (values.candidates === undefined) {
    write(values.name, largestSet(similarity, sentences, threshold, true).members)
    return
  }
  const count = Number(values.candidates)
  if (!Number.isInteger(count) || count < 1) throw new Error('--candidates is how many candidate references to make, a whole number')
  printCandidates(writeCandidates(group!, values.name, threshold, seconds, count), count, threshold, seconds)
}

function printCandidates(written: readonly ReferenceManifest[], count: number, threshold: number, seconds: number): void {
  if (written.length < count) console.log(`the takes make ${written.length} candidates of ${seconds} s in which every pair is ${threshold} or more alike, not ${count}`)
  for (const reference of written) {
    console.log(`${reference.name}: ${reference.takes.length} takes, ${reference.seconds.toFixed(1)} s, every pair ${reference.weakestPair.toFixed(2)} or more alike, ${reference.meanSimilarity.toFixed(2)} on average`)
    for (const take of reference.takes) console.log(`  ${take.likenessToCenter.toFixed(2)}  ${take.label}  ${take.text}`)
  }
}

/** Making a voice from its recipe in prompts/voices-<locale>.json: gather, candidates, try and choose. */
export async function voice(args: string[]): Promise<void> {
  const [step, ...rest] = args
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { locale: { type: 'string' }, model: { type: 'string' }, seeds: { type: 'string' }, threshold: { type: 'string', default: '0.8' }, seconds: { type: 'string', default: '10' }, count: { type: 'string', default: '3' } }
  })
  const locale = values.locale
  if (!locale || !isLanguageTag(locale)) throw new Error('--locale is a BCP 47 tag such as ja-JP')
  if (step === 'list') {
    for (const recipe of loadRecipes(locale)) console.log(`${recipe.id}  ${recipe.description}  ${recipe.lines.length} lines  ${recipe.chosen ? `chosen ${recipe.chosen.candidate}` : 'not chosen'}`)
    return
  }
  const [id, candidate] = positionals
  if (!id) throw new Error(`voice ${step ?? ''} needs the voice, one of the ids in prompts/voices-${locale}.json`)
  const recipe = recipeOf(locale, id)
  if (step === 'gather') {
    const files = await gatherTakes(recipe, locale, ttsModel(values.model ?? 'irodori-tts-v4-small-q8_0-16steps'), seedList(values.seeds ?? '1,2,3,4,5'))
    console.log(`${files.length} runs joined campaign ${voiceCampaign(id)}`)
  } else if (step === 'candidates') {
    const threshold = Number(values.threshold)
    const seconds = Number(values.seconds)
    const count = Number(values.count)
    if (!(threshold > 0 && threshold < 1) || !(seconds > 0 && seconds <= 120) || !(Number.isInteger(count) && count > 0)) throw new Error('--threshold is a similarity between 0 and 1, --seconds up to 120 and --count a whole number')
    printCandidates(await makeCandidates(recipe, threshold, seconds, count), count, threshold, seconds)
  } else if (step === 'try') {
    const files = await tryCandidates(recipe, locale, ttsModel(values.model ?? 'irodori-tts-v4.1-small-mf'), loadPrompts('speak', locale), seedList(values.seeds ?? '1,2'))
    console.log(`${files.length} runs joined campaign ${voiceCampaign(id)}; compare them under Voices in the web app, "node src/cli.ts web"`)
  } else if (step === 'choose') {
    if (!candidate) throw new Error('voice choose needs the voice and the candidate chosen')
    await chooseCandidate(recipe, locale, candidate)
    console.log(`${id} speaks like ${candidate} from now on, kept as voice-${id}`)
  } else {
    throw new Error('voice is followed by list, gather, candidates, try or choose')
  }
}
