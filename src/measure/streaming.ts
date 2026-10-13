import type { SentenceRecord } from './result-file/format.ts'

type Chunks = NonNullable<SentenceRecord['chunks']>

/** The time between each piece of a sentence's audio and the one before it. */
export const chunkGaps = (chunks: Chunks): number[] => chunks.slice(1).map((chunk, index) => chunk.seconds - chunks[index]!.seconds)

/**
 * The least audio a player held that started playing a sentence as its first piece arrived and played each piece as
 * it came: as each later piece arrives, the audio of the pieces before it less the time played since the first. Below
 * zero the playback would have stopped and waited. Null for a sentence that came in one piece, which never waits.
 */
export function leastAudioInHand(chunks: Chunks): number | null {
  const [first] = chunks
  if (!first || chunks.length < 2) return null
  let received = 0
  let least = Number.POSITIVE_INFINITY
  for (const [index, chunk] of chunks.entries()) {
    if (index > 0) least = Math.min(least, received - (chunk.seconds - first.seconds))
    received += chunk.audioSeconds
  }
  return least
}
