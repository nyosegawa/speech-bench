# Speech synthesis on an Apple M5, 2026-09-30

The 20 Japanese sentences of prompts/speak-ja-JP.json (4 aizuchi, 5 replies, 3 with numbers, 3 with
English words, 2 questions, 3 long), on an Apple M5 with 32 GB and macOS 26.2 (Metal). Qwen3-TTS ran in
qwen3-tts-ggml v0.1.1 with the voice ono_anna; Irodori-TTS v4 Small ran in audio.cpp
v0.8.2-audio8-perf-hotfix without a reference, so its voice changes from sentence to sentence. The speech
was transcribed by Qwen3-ASR 1.7B (llama.cpp b11246) after the synthesis model had stopped, and scored with
Japanese numbers read as digits (docs/adr/0002).

| Model | Heard CER | Median first audio | p90 first audio | RTF | Seconds per character |
|---|---|---|---|---|---|
| Qwen3-TTS 0.6B | 6.30% | 0.050 s | 0.055 s | 0.43 | 0.216 |
| Qwen3-TTS 1.7B | 3.98% | 0.077 s | 0.085 s | 0.58 | 0.177 |
| Irodori-TTS v4 Small, 8 steps | 2.82% | 1.04 s | 2.99 s | 0.24 | 0.178 |
| Irodori-TTS v4 Small, 16 steps | 2.49% | 1.22 s | 3.58 s | 0.28 | 0.178 |
| Irodori-TTS v4 Small, 40 steps | 2.99% | 1.89 s | 5.45 s | 0.43 | 0.178 |

- Qwen3-TTS streams: its first audio comes within 0.08 s whatever the length of the sentence. Irodori-TTS
  in audio.cpp answers with the whole sentence, so its first audio grows with the sentence: the three long
  sentences (about 10 s of speech) took 3.0 to 3.5 s at 8 steps and 5.5 to 6.4 s at 40 steps.
- The misreadings in the number sentences: Qwen3-TTS 0.6B read 暗証番号 as 鑑賞番号 and 8264 as 八メキ二十六四,
  and Qwen3-TTS 1.7B read 8264 as 八二五六四. The Irodori-TTS runs read the numbers right.
- Qwen3-TTS runs on past short sentences. 0.6B spoke はい。 as はい、マッチに出て、はい。 (the aizuchi CER is 75%
  for 0.6B, 25% for 1.7B), and 1.7B added ああ、うん。 after a number sentence. ASIST cuts such speech at a
  plausible length and generates the clip again; the bench measures the model as it is.
- Qwen3-TTS 0.6B speaks at 0.216 s per character against 0.177 to 0.178 for the others, which includes the
  silence of up to a second it puts before the voice (ADR 0021 of ASIST).
- Irodori-TTS read about as accurately at 8, 16 and 40 steps (2.5% to 3.0%). These are 20 sentences in a
  voice made up per sentence, so the differences between the step counts are within what one bad sentence
  moves.
