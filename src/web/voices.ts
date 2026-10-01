import fs from 'node:fs'
import type { SpeakerEmbedder } from '../engines/speaker-embedding.ts'
import { loadRecipes, recipeOf, type Choice } from '../make/recipes.ts'
import { referenceFile, referenceManifest } from '../make/references.ts'
import { candidatesOf, chooseCandidate, voiceRuns } from '../make/voice.ts'
import { parseResultFile, type TtsRunRecord } from '../measure/results.ts'
import { latestRuns, readTtsRuns, type UrlOf } from '../pages/listen.ts'
import { voicesData } from '../pages/voices.ts'
import type { ChosenVoices, TrySet, VoiceDetail, VoiceRow } from './api.ts'

const runOf = (file: string): TtsRunRecord => parseResultFile(fs.readFileSync(file, 'utf8').split('\n')).run as TtsRunRecord

/** The sentences tried and the length factor, which the tries compared on one page share. */
const trySetOf = (run: TtsRunRecord): Omit<TrySet, 'runs' | 'references'> => ({
  key: run.durationScale === null ? run.set.name : `${run.set.name} ×${run.durationScale}`,
  set: run.set.name,
  durationScale: run.durationScale
})

/** The tries grouped by what they spoke, those that compare the most references first. */
function trySets(files: readonly string[]): Array<TrySet & { files: string[] }> {
  const sets = new Map<string, Omit<TrySet, 'runs' | 'references'> & { files: string[]; names: Set<string> }>()
  for (const file of files) {
    const run = runOf(file)
    const set = trySetOf(run)
    const known = sets.get(set.key) ?? { ...set, files: [], names: new Set<string>() }
    sets.set(set.key, { ...known, files: [...known.files, file], names: new Set([...known.names, run.reference!.name]) })
  }
  return [...sets.values()]
    .map(({ names, ...set }) => ({ ...set, runs: set.files.length, references: names.size }))
    .sort((a, b) => b.references - a.references || b.runs - a.runs || a.key.localeCompare(b.key))
}

const referenceOf = (name: string): { manifest: ReturnType<typeof referenceManifest>; file: string } => ({ manifest: referenceManifest(name), file: referenceFile(name) })

export function voiceRows(locale: string): VoiceRow[] {
  return loadRecipes(locale).map((recipe) => {
    const runs = voiceRuns(recipe.id)
    return { id: recipe.id, description: recipe.description, lines: recipe.lines.length, chosen: recipe.chosen, gathered: runs.gathered.length, candidates: candidatesOf(recipe.id), tried: runs.tried.length }
  })
}

/**
 * A voice with its candidates and, for the sentences and length factor asked for or else the ones tried most,
 * how each candidate spoke them, every take compared with the reference it spoke like.
 */
export function voiceDetail(locale: string, id: string, setKey: string | null, embedder: SpeakerEmbedder, embeddingOf: (reference: string) => Float32Array, urlOf: UrlOf): VoiceDetail {
  const recipe = recipeOf(locale, id)
  const runs = voiceRuns(id)
  const sets = trySets(runs.tried)
  const chosenSet = setKey === null ? sets[0] : sets.find((set) => set.key === setKey)
  if (setKey !== null && !chosenSet) throw new Error(`${id} has no tries of ${setKey}; it has ${sets.map((set) => set.key).join(', ') || 'none'}`)
  const tries = chosenSet ? latestRuns(readTtsRuns(chosenSet.files, embedder, () => true, (run) => embeddingOf(run.reference!.name))) : []
  return {
    locale,
    recipe,
    gathered: runs.gathered.length,
    candidates: candidatesOf(id).map((name) => {
      const manifest = referenceManifest(name)
      return { name, url: urlOf(referenceFile(name)), seconds: manifest.seconds, takes: manifest.takes.length, meanSimilarity: manifest.meanSimilarity, weakestPair: manifest.weakestPair }
    }),
    trySets: sets.map(({ files: _files, ...set }) => set),
    trySet: chosenSet?.key ?? null,
    tries: tries.length > 0 ? voicesData(tries, referenceOf, urlOf, id) : null
  }
}

/**
 * The tries of the reference a voice chose: those that named the candidate or, when none did, those that named
 * the copy kept as the voice, since both hold the same audio and would show as two candidates.
 */
function triesOfChoice(id: string, chosen: Choice): string[] {
  const tried = voiceRuns(id).tried.map((file) => ({ file, name: runOf(file).reference!.name }))
  const named = (name: string): string[] => tried.filter((entry) => entry.name === name).map((entry) => entry.file)
  return named(chosen.candidate).length > 0 ? named(chosen.candidate) : named(chosen.reference)
}

/**
 * The chosen voices side by side: the tries of each voice's chosen reference on the sentences and length factor
 * the most voices tried it with, so that every voice is heard on the same sentences.
 */
export function chosenVoices(locale: string, embedder: SpeakerEmbedder, embeddingOf: (reference: string) => Float32Array, urlOf: UrlOf): ChosenVoices {
  const chosen = loadRecipes(locale).flatMap((recipe) => (recipe.chosen ? [{ id: recipe.id, choice: recipe.chosen, files: triesOfChoice(recipe.id, recipe.chosen) }] : []))
  const voiceOf = Object.fromEntries(chosen.flatMap((voice) => [[voice.choice.candidate, voice.id], [voice.choice.reference, voice.id]]))
  const voicesIn = new Map<string, Set<string>>()
  for (const voice of chosen) for (const set of trySets(voice.files)) voicesIn.set(set.key, new Set([...(voicesIn.get(set.key) ?? []), voice.id]))
  const [key] = [...voicesIn.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0] ?? []
  if (key === undefined) return { trySet: null, voiceOf, missing: chosen.map((voice) => voice.id), voices: null }
  const files = chosen.flatMap((voice) => voice.files.filter((file) => trySetOf(runOf(file)).key === key))
  const runs = latestRuns(readTtsRuns(files, embedder, () => true, (run) => embeddingOf(run.reference!.name)))
  return { trySet: key, voiceOf, missing: chosen.filter((voice) => !voicesIn.get(key)!.has(voice.id)).map((voice) => voice.id), voices: voicesData(runs, referenceOf, urlOf, locale) }
}

/** Keeps a candidate as the voice's reference, after checking that it is one of the voice's candidates. */
export async function choose(locale: string, id: string, candidate: string): Promise<Choice> {
  const recipe = recipeOf(locale, id)
  if (!candidatesOf(id).includes(candidate)) throw new Error(`${candidate} is not a candidate of ${id}; its candidates are ${candidatesOf(id).join(', ') || 'none yet'}`)
  await chooseCandidate(recipe, locale, candidate)
  return recipeOf(locale, id).chosen!
}
