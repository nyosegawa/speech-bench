# A voice is judged by speaker embeddings of sentences with enough voice

Whether a synthesis run keeps one voice is measured with 3D-Speaker's ERes2NetV2 speaker embeddings, computed
through sherpa-onnx's Node addon: the mean cosine similarity of every pair of the run's sentences that have
1.5 s of voice or more. The median pitch of each sentence and its spread are shown beside it. A model without
built-in voices, such as Irodori-TTS, can change its speaker between sentences, which a user of ASIST hears at
once and the recognition error rate cannot show.

## Rejected

- **WeSpeaker ResNet34-LM.** It told recorded speakers apart, but rated Irodori-TTS without a voice description, whose voice changes between sentences,
  0.65 alike against 0.73 for Qwen3-TTS's one voice.
- **Pitch alone.** It tells a man from a woman but not two women of one pitch.
- **Embedding every sentence.** Utterances with little voice embed poorly: Qwen3-TTS's はい, あー and なるほど,
  with 0.5 to 1.1 s of voice, were 0.42 to 0.51 like the one voice's other sentences, against 0.66 to 0.76.
- **WavLM-large with ECAPA-TDNN, which synthesis papers report.** It has no ONNX export to pin.
- **The sherpa-onnx-node package as a dependency.** Its addon is taken from the npm tarballs by URL and
  sha256 instead, as every runtime is.

## Measured

2026-10-01, Apple M5, over utterances with 1.5 s of voice or more.

| Speech | Mean similarity |
|---|---|
| The author's 31 recordings (19 judged), with each other | 0.84 |
| The author's recordings, with the 82 by men among the first 100 of FLEURS ja-JP test | 0.33 |
| The author's recordings, with the 18 by women among them | 0.05 |
| Qwen3-TTS 0.6B and 1.7B, ono_anna, 20 sentences | 0.77 and 0.76 |
| Irodori-TTS v4 Small without a voice description, 20 sentences at 8, 16 and 40 steps | 0.50, 0.47, 0.51 |
| Irodori-TTS v4 Small, 16 steps, ten sentences from each of seeds 1 to 5 | 0.48 to 0.57 |
| Irodori-TTS v4 Small, 16 steps, seed 1, nine voice descriptions | 0.36 to 0.73 |

FLEURS names no speakers, and two of its recordings of one sentence were up to 0.95 alike, so its recordings
are not taken as different people among themselves; the author is not among its speakers. None of the models
was trained on Japanese; the author's recordings against FLEURS show that ERes2NetV2 still separates Japanese
voices.
