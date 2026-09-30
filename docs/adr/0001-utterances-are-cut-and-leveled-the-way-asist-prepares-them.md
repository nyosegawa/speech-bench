# Utterances are cut and leveled the way ASIST prepares them

By default every utterance is prepared the way ASIST prepares a capture before it sends it to speech
recognition. The recording is scaled to a peak of 0.9, cut from 300 ms before ASIST's energy VAD would open
a capture to the end of the hangover (600 ms by default) after it would close it, and scaled to a peak of
0.9 again. `--edges as-recorded` still sends a recording as it is. The bench exists to tell what a user of
ASIST gets, and public recordings are not what ASIST sends: the Japanese FLEURS recordings start with 1.3 s
of silence on average, and models trained on conversation and broadcast speech write words nobody said
into that silence.

## Rejected

- **Running Silero VAD in the bench.** ASIST cuts a capture by energy alone; Silero only confirms that the
  energy is a voice, so it does not move the edges of a clip that is plainly speech.
- **Sending recordings as they are by default.** Their long edges are not what ASIST sends, and they
  doubled the error rate of two of the three models measured.
- **Splitting a recording where ASIST would split it.** ASIST closes a capture at every pause longer than
  the hangover and at 20 s, but a reference belongs to the whole recording. The split captures would need
  references of their own.

## Measured

2026-09-30, Apple M5, the first 100 utterances of the Japanese FLEURS test split, Q8_0, llama.cpp b11246
and CrispASR v0.8.38.

| Model | CER as recorded | CER cut like ASIST |
|---|---|---|
| Qwen3-ASR 1.7B | 5.29% | 5.31% |
| parakeet-tdt_ctc-0.6b-ja | 12.02% | 8.18% |
| ReazonSpeech NeMo v2 | 11.90% | 7.32% |

The error rates are scored with Japanese numbers read as digits (docs/adr/0002).

- Utterances into which a model wrote a filler nobody said (えっ, うん, はあ and the like): parakeet 61 as
  recorded and 18 cut, ReazonSpeech 57 and 10, Qwen3-ASR 0 and 0.
- The cut shortened the utterances from 13.4 s to 11.2 s on average.
- 18 of the 100 recordings never reach the lowest threshold of ASIST's VAD (an RMS of 0.012) at their
  recorded level; a microphone's gain would have raised them, which the first scaling stands in for.
- ASIST would split 16 of the 100 recordings at a pause, and 3 of them run past 20 s.

## Known limits

- The VAP, which moves ASIST's hangover when MaAI is on, and the discarding of a capture Silero does not
  confirm as a voice are not reproduced.
- The frames are 341 samples, what a 48 kHz microphone delivers; another microphone rate moves the edges by
  up to one frame.
