# Nemotron 3.5 Transcribe in speech.cpp, 2026-10-29

speech.cpp's port of Nemotron 3.5 Transcribe 30B-A4B (nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B at ef905575), in
its F16, Q8_0 and IQ4_NL files of sakasegawa/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B-GGUF at c5985ae0, from local builds
of speech.cpp's branch `nemotron-transcribe-reference` (5585f1ae on the H100, a5d9f4fd on the M5), in the campaign
`nemotron-transcribe-20261029`. speech.cpp gives the model the card's verbatim instruction. The sets are those of
docs/measurements/nemotron-3.5-transcribe-on-an-apple-m5-2026-10-29.md, the first 100 utterances of FLEURS ja-JP and
en-US and of Common Voice 8.0 ja, trimmed to the voice with 0.2 s around it, and on the H100 also the whole of Common
Voice 8.0's Japanese test set. CER for Japanese and WER for English as the bench counts them, as written, with the CER
accepting other spellings after the slash.

## An H100 with Vulkan

NVIDIA H100 80GB HBM3 on RunPod, Ubuntu 22.04.5, driver 595.91.07, Vulkan SDK 1.4.357.0.

| Set | Type | Error rate | Empty | p50 s | RTFx | GPU memory GiB | Load s |
|---|---|---|---|---|---|---|---|
| FLEURS ja | F16 | 6.05% / 2.64% | 0 | 0.526 | 17.3 | 61.6 | 23.9 |
| FLEURS ja | Q8_0 | 5.86% / 2.64% | 0 | 0.388 | 23.1 | 33.4 | 13.1 |
| FLEURS ja | IQ4_NL | 5.88% / 2.62% | 0 | 0.386 | 23.8 | 18.4 | 7.5 |
| Common Voice ja, 100 | F16 | 10.51% / 4.44% | 0 | 0.248 | 13.3 | 61.6 | 23.8 |
| Common Voice ja, 100 | Q8_0 | 11.92% / 5.53% | 0 | 0.217 | 15.4 | 33.4 | 14.0 |
| Common Voice ja, 100 | IQ4_NL | 11.71% / 5.47% | 0 | 0.217 | 12.5 | 18.4 | 7.1 |
| Common Voice ja, all | F16 | 8.85% / 5.06% | 0 | 0.260 | 13.4 | 61.6 | 22.3 |
| Common Voice ja, all | Q8_0 | 9.01% / 5.17% | 0 | 0.224 | 16.0 | 33.4 | 13.8 |
| Common Voice ja, all | IQ4_NL | 9.16% / 5.33% | 0 | 0.228 | 15.7 | 18.4 | 7.2 |
| FLEURS en | F16 | 8.73% | 0 | 0.393 | 20.0 | 61.6 | 23.3 |
| FLEURS en | Q8_0 | 8.64% | 0 | 0.294 | 26.2 | 33.4 | 13.8 |
| FLEURS en | IQ4_NL | 8.77% | 0 | 0.293 | 26.0 | 18.4 | 7.1 |

The voice detector dropped 1 of the first 100 Common Voice clips and 4 of the whole set.

- **IQ4_NL measures as Q8_0 does** on every set, within 0.2 points, at the same speed in 55% of the GPU's memory, and
  the type speech.cpp's name fetches is IQ4_NL. Over the whole of Common Voice, F16 is 0.16 points below Q8_0.
- **The first 100 Common Voice clips mislead by a point and a half**: F16 is 1.4 points below Q8_0 on them and 0.16 on
  the whole set.
- **The first request after a type's first load took 6.8 to 10.7 s** where the others took 0.2 to 0.5 s, once for each
  type on the pod and not again in later processes: NVIDIA's driver compiling the shaders the warm-up did not reach and
  caching them.
- **The first FLEURS runs of IQ4_NL measured nothing**: bsdtar could not set the clips' owner in the pod's container
  and the run ended with its error; the later runs found the clips unpacked, and IQ4_NL's FLEURS runs were made again.

## An Apple M5

The MacBook Pro of docs/measurements/nemotron-3.5-transcribe-on-an-apple-m5-2026-10-29.md (32 GB, macOS 26.2, Metal),
the published IQ4_NL file, nothing else running.

| Set | Error rate | Empty | p50 s | RTFx | Peak memory GiB (RSS + Metal) | Load s |
|---|---|---|---|---|---|---|
| FLEURS ja | 6.11% / 2.82% | 0 | 1.285 | 7.0 | 17.2 | 5.8 |
| Common Voice ja | 11.71% / 5.47% | 0 | 0.607 | 5.4 | 17.2 | 5.2 |
| FLEURS en | 8.68% | 0 | 0.883 | 8.5 | 17.2 | 4.8 |

- Beside the runtimes of the same day on the same sets: NeMo-Speech.cpp with its IQ4_NL decoder gave 5.91%, 30.24% (17
  clips empty) and 8.87% at RTFx 4.3 to 5.4 in 18.2 to 18.7 GiB, and mlx-audio's 4-bit conversion of the early-access
  checkpoint 6.01%, 12.68% and 11.21% at RTFx 4.7 to 10.2 in 36 GiB.
- On Common Voice the M5 writes what the H100 writes, 11.71% / 5.47%; on FLEURS ja Metal's rounding takes a few other
  tokens, 6.11% against 5.88%.
- A run of the IQ4_NL file that speech quantize wrote on the M5 from the same F32 file, whose blocks differ from the
  published one's in about 0.1% by a step of the scale or one value, gave 5.80%, 11.60% and 8.77% while a download ran
  beside it, at RTFx 4.1 to 6.8.
