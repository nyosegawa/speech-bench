# Irodori-TTS v4.1 in its official runtime and in speech.cpp, 2026-10-01

Irodori-TTS v4.1 Small, MF and RF at 16 steps, spoke the 20 sentences of `prompts/speak-ja-JP.json` on an Apple
M5 like voice-bright-young-woman with seed 1: in its official PyTorch runtime (Irodori-TTS 89f9d8fbd4d5, FP32
on MPS, through `adapters/irodori-tts/`) and in speech.cpp v0.3.0 (F16 GGUFs on Metal,
speech-cpp-v0.3.0-2026-10-01.md). The official runtime was given the reference as its WAVE file; speech.cpp as
a voice file made on the CPU. The two draw their noise differently from the same seed, so the takes are not the
same samples. The speech was heard by Qwen3-ASR 1.7B and scored by docs/adr/0002, 0006 and 0007; sameness of
voice and likeness to the reference are mean cosine similarities of ERes2NetV2 speaker embeddings
(docs/adr/0005). One run each.

| Model | Runtime | Heard CER | Heard as said | Same voice | Like the reference | Pitch | First audio, median | RTF |
|---|---|---|---|---|---|---|---|---|
| MF | official | 8.62% | 8 of 20 | 0.88 | 0.88 | 314 Hz | 3.80 s | 0.57 |
| MF | speech.cpp | 6.14% | 9 of 20 | 0.83 | 0.84 | 314 Hz | 0.26 s | 0.18 |
| RF, 16 steps | official | 3.48% | 12 of 20 | 0.84 | 0.87 | 314 Hz | 6.54 s | 0.98 |
| RF, 16 steps | speech.cpp | 3.15% | 13 of 20 | 0.83 | 0.82 | 308 Hz | 1.22 s | 0.34 |

- speech.cpp's takes sound less like the reference than the official runtime's, by 0.04 for MF and 0.05 for
  RF at 16 steps, and less like each other for MF (0.83 against 0.88; 0.83 against 0.84 at 16 steps).
- The recognizer's errors differ by 2.5 points for MF and 0.3 for RF, in opposite directions.
- はい came out 3.44 s long in all four runs, heard as はい、これ。, はい、昨日今日はちょっとはいいよ。,
  はい。うん。 and はい。おお。: the reference makes it long in the original as in the port.
- The official runtime does not stream, so its first audio is the whole sentence. speech.cpp made the speech
  in a third of the time (RTF 0.18 against 0.57 for MF, 0.34 against 0.98 at 16 steps).
