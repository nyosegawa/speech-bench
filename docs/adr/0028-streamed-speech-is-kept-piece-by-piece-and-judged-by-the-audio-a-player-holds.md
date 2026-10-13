# Streamed speech is kept piece by piece, and judged by the audio a player holds

A synthesis run keeps, for each sentence, every piece of audio as it arrived: when, in seconds from sending the
text, and how many seconds of speech it held (result format 17). The report counts from them, as it counts the error
rates from the texts, so that a later figure is counted from the same record:

- **Inter-chunk latency**: the time between two pieces of a sentence, at p50, p90 and p99 over every gap of the run.
- **Least audio in hand**: a player that starts a sentence as its first piece arrives and plays every piece as it
  comes holds, as each later piece arrives, the speech of the pieces before it less the time it has played since the
  first. The least over the run is the margin the stream left; below zero the player would have stopped and waited.

A sentence that comes in one piece has no gap and never waits, and a run whose every sentence came whole is written
`whole`, apart from a run made before the pieces were kept.

## Rejected

- **Storing the figures instead of the pieces.** A figure counted another way later, such as the margin of a player
  that waits for a buffer first, could not be counted from them.
- **Real-time factor of each piece.** A piece that arrives late after a long one is still in time; what a listener
  hears break is the player running out, which the audio in hand measures.
