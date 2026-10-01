# speech.cpp v0.3.0, 2026-10-01

speech.cpp v0.3.0 run through its worker protocol (docs/adr/0008) on the 20 sentences of
`prompts/speak-ja-JP.json`, on an Apple M5 (Metal, macOS 26.2) and an RTX 2080 (Vulkan, Windows 11). Qwen3-TTS
spoke with its built-in voice ono_anna and a seed the runtime chose for each sentence. Irodori-TTS v4.1 Small
spoke like voice-bright-young-woman (bright-young-woman-pair-3, irodori-sixteen-voices-2026-10-01.md) with seed 1,
through a voice file that `irodori-tts --make-voice` made on the CPU. The speech was heard by Qwen3-ASR 1.7B and
scored by docs/adr/0002, 0006 and 0007.

| Model | Machine | Heard CER | Heard as said | First audio, median | First audio, p90 | RTF | Load s |
|---|---|---|---|---|---|---|---|
| Qwen3-TTS 0.6B CustomVoice Q8_0 | M5 | 7.79% | 10 of 20 | 0.042 s | 0.062 s | 0.37 | 1.7 |
| Qwen3-TTS 0.6B CustomVoice Q8_0 | RTX 2080 | 8.13% | 12 of 20 | 0.034 s | 0.043 s | 0.32 | 14.7 |
| Qwen3-TTS 1.7B CustomVoice Q8_0 | M5 | 7.96% | 11 of 20 | 0.066 s | 0.116 s | 0.49 | 2.4 |
| Qwen3-TTS 1.7B CustomVoice Q8_0 | RTX 2080 | 6.47% | 13 of 20 | 0.041 s | 0.060 s | 0.35 | 2.9 |
| Irodori-TTS v4.1 Small MF F16 | M5 | 6.14% | 9 of 20 | 0.26 s | 0.54 s | 0.18 | 2.2 |
| Irodori-TTS v4.1 Small MF F16 | RTX 2080 | 7.13% | 9 of 20 | 0.13 s | 0.20 s | 0.07 | 2.3 |
| Irodori-TTS v4.1 Small F16, 16 steps | M5 | 3.15% | 13 of 20 | 1.22 s | 3.41 s | 0.34 | 3.9 |
| Irodori-TTS v4.1 Small F16, 16 steps | RTX 2080 | 3.15% | 13 of 20 | 0.54 s | 1.14 s | 0.13 | 2.8 |

On the RTX 2080, Qwen3-TTS 0.6B was the first Qwen3-TTS model this version loaded there; the 1.7B model loaded after
it in 2.9 s.

## What the numbers show

- From the same seed, Irodori-TTS v4.1 at 16 steps spoke so alike on both machines that the recognizer heard all
  20 sentences the same, and no sentence differed in length by more than 0.04 s. The MF model was heard the same
  in 18 of 20.
- On the RTX 2080 Irodori-TTS's first audio came in half the M5's time or less. Qwen3-TTS's median first audio
  is 0.03 to 0.07 s on both machines, a sixth to a third of the MF model's.
- Qwen3-TTS draws a new seed for every sentence, so one run's error rate moves by several points: the 1.7B
  model was heard at 3.81% and 11.28% in qwen3-tts-ggml v0.1.1 on 2026-09-30 (M5 and RTX 2080), and at 7.96% and
  6.47% here. The runtimes do not differ beyond that. On the M5, v0.3.0 took about 85% of v0.1.1's time to the
  first audio and about the same share of its synthesis time (RTF 0.37 against 0.43 for 0.6B, 0.49 against 0.58
  for 1.7B); on the RTX 2080 the two took the same time.
- はい was 3.44 s long from both Irodori-TTS v4.1 models on both machines, heard as はい、これ。(MF) and
  はい。うん。(16 steps). The same reference made it 3.32 s long in audio.cpp's v4 Small (2026-09-30), and the
  other references cut from the same takes (pairs 1, 2, 4 and 5, the controls, and those of 10 and 30 s) 1.00 to
  1.16 s: the length comes from the reference, not from the runtime. The worker of v0.3.0 takes no length factor,
  which shortened aizuchi in audio.cpp (irodori-sixteen-voices-2026-10-01.md).
