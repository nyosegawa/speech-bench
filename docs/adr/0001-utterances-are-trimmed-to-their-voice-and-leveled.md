# Utterances are trimmed to their voice and leveled

By default every utterance is trimmed to its voice before a model hears it: Silero VAD finds where the voice
begins and ends, the recording is kept from 0.2 s before the first stretch of voice to 0.2 s after the last,
as far as the recording reaches, and scaled to a peak of 0.9. Pauses inside the utterance are kept. Every
model then hears the same stretch of speech at the same level, whatever silence the recording had around
it. `--edges as-recorded` still sends a recording as it is, with silence added after it, which shows how a
model takes long silence.

Public recordings are not what a speaker says to an application: the Japanese FLEURS recordings start with
1.3 s of silence on average, and models trained on conversation and broadcast speech write words nobody said
into that silence. Silero tells a voice from the room by what it sounds like rather than by how loud it is,
so a quiet recording is trimmed like a loud one.

## Rejected

- **Cutting the way ASIST's energy VAD cuts a capture, with its hangover.** It measured models under the
  thresholds and hangover of one application, and kept the whole of a quiet recording, room noise included,
  once the scaling had raised the room above the VAD's starting noise floor (38 of the first 100 Japanese
  FLEURS recordings). The bench serves no one application.
- **Sending recordings as they are by default.** Their long silences doubled the error rate of two of the
  three models measured.
- **Padding the voice with digital silence instead of the recording's own margin.** A cut at the VAD's
  boundary can clip a soft onset; the recording around it keeps what the VAD missed.

## Measured

2026-10-01, Apple M5, the first 100 utterances of the Japanese FLEURS test split, Q8_0, llama.cpp b11246 and
CrispASR v0.8.38, scored by docs/adr/0002 and 0006.

| Model | CER as recorded | Cut like ASIST | Trimmed to the voice |
|---|---|---|---|
| Qwen3-ASR 1.7B | 5.29% | 5.31% | 5.76% |
| parakeet-tdt_ctc-0.6b-ja | 12.02% | 8.16% | 6.71% |
| ReazonSpeech NeMo v2 | 11.88% | 7.30% | 7.69% |

- Utterances into which a model wrote a filler that was not said (えっ, うん, はあ and the like): parakeet 60
  as recorded, 23 cut like ASIST and 9 trimmed; ReazonSpeech 48, 15 and 14; Qwen3-ASR 1, 2 and 3.
- The utterances were 13.4 s long on average as recorded, 11.2 s cut like ASIST and 9.8 s trimmed.
- Of the 44 characters Qwen3-ASR 1.7B misheard trimmed and not cut like ASIST, 18 are one word written in
  katakana (シビリス for civilis); the others are single words in the middle of sentences, which change when
  the audio starts at another sample. No trimmed utterance lost its first or last word.
- Silero found voice in all 100 recordings and in all 31 of the author's, down to a はい with 0.23 s of voice.
