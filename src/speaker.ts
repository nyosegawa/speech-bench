import type { Pcm } from './wav.ts'

/**
 * The voice an utterance needs before its speaker embedding says who speaks. Qwen3-TTS's one voice
 * (ono_anna, 2026-10-01) gave はい, あー and なるほど, with 0.5 to 1.1 s of voice, a likeness to its other
 * sentences of 0.42 to 0.51, against 0.66 to 0.76 for sentences with 2.3 s or more.
 */
export const MIN_VOICED_SECONDS = 1.5

/** Seconds of 20 ms frames within 20 dB of the loudest one: the voice in an utterance, without its pauses. */
export function voicedSeconds(pcm: Pcm): number {
  const frame = Math.round(pcm.sampleRate / 50)
  const levels: number[] = []
  for (let from = 0; from + frame <= pcm.samples.length; from += frame) {
    let energy = 0
    for (let index = from; index < from + frame; index++) energy += pcm.samples[index]! ** 2
    levels.push(Math.sqrt(energy / frame))
  }
  const loudest = Math.max(0, ...levels)
  return loudest === 0 ? 0 : levels.filter((level) => level >= loudest * 0.1).length / 50
}

/** The cosine similarity of two speaker embeddings: 1 for the same direction. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`embeddings of ${a.length} and ${b.length} dimensions cannot be compared`)
  let product = 0
  let left = 0
  let right = 0
  for (let index = 0; index < a.length; index++) {
    product += a[index]! * b[index]!
    left += a[index]! ** 2
    right += b[index]! ** 2
  }
  return product / Math.sqrt(left * right)
}

/** The similarity of every pair of utterances, each pair once. */
export function pairwise(embeddings: readonly Float32Array[]): number[] {
  const similarities: number[] = []
  for (let first = 0; first < embeddings.length; first++) {
    for (let second = first + 1; second < embeddings.length; second++) similarities.push(cosine(embeddings[first]!, embeddings[second]!))
  }
  return similarities
}

/** The similarity of every utterance of one set to every utterance of another. */
export function across(left: readonly Float32Array[], right: readonly Float32Array[]): number[] {
  return left.flatMap((a) => right.map((b) => cosine(a, b)))
}

/**
 * How much each utterance sounds like the others of its run: the mean similarity to the other utterances,
 * which singles out a sentence spoken in another voice.
 */
export function likenessToTheRest(embeddings: readonly Float32Array[]): number[] {
  return embeddings.map((embedding, index) => {
    const others = embeddings.filter((_, other) => other !== index)
    return others.reduce((sum, other) => sum + cosine(embedding, other), 0) / others.length
  })
}
