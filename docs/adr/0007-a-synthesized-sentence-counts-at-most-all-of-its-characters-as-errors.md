# A synthesized sentence counts at most all of its characters as errors

The heard error rate of synthesized speech counts, for each sentence, at most as many errors as the sentence
has characters (or words), and sums them over the set. A take that runs on is broken whatever its length,
which the listening and voices pages show among the broken takes; counted in full, one such take decided the
rate of a whole voice. Speech recognition keeps the rate the public benchmarks report, without the cap.

On 2026-10-01 Irodori-TTS, speaking like the reference voice bright-young-woman-pair-3, made あー。 a 3.8 s
drawn-out vowel that Qwen3-ASR 1.7B wrote as あ 511 times: 511 errors against a sentence of two characters,
which made 46.6% of the voice's 1,206 characters over two seeds. With the cap the voice reads 3.5%, against
1.8% for the best of its candidates, which still shows its four aizuchi breaking down.

## Rejected

- **Capping speech recognition too.** It would part the bench's rates from the public benchmarks it is read
  against, and a recognizer that writes far more than was said hands all of it to ASIST's conversation model.
- **The median of the sentences' rates.** It hides a few broken sentences among good ones, and weighs a
  two-character aizuchi as much as a long sentence.
- **Leaving broken takes out of the rate.** Their count shows that they broke, but not how much of the rest
  was misread.

## Measured

2026-10-01, the latest run of each synthesis model on each machine, with the long vowel rule of
docs/adr/0006 on both sides.

| Run | Uncapped | Capped |
|---|---|---|
| Qwen3-TTS 0.6B, RTX 2080 | 12.77% | 7.63% |
| Qwen3-TTS 0.6B, Apple M5 | 6.30% | 5.31% |
| Qwen3-TTS 1.7B, RTX 2080 | 11.94% | 11.28% |
| Qwen3-TTS 1.7B, Apple M5 | 3.81% | 3.81% |
| Irodori-TTS v4 Small, 8, 16 and 40 steps, both machines | 1.66% to 2.82% | unchanged |
| Irodori-TTS v4 Small 16 steps, reference bright-young-woman-pair-3 | 46.6% | 3.5% |
