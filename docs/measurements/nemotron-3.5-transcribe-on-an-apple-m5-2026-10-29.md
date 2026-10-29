# Nemotron 3.5 Transcribe on an Apple M5, 2026-10-29

The first 100 utterances of the FLEURS test splits of ja-JP and en-US and of the Common Voice 8.0 Japanese test split,
trimmed to the voice with 0.2 s around it, on an Apple M5 with 32 GB and macOS 26.2 (Metal), in the campaign
`nemotron-transcribe-20261029`. NeMo-Speech.cpp ran the release checkpoint (nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B
at ef905575) converted by its converter to an IQ4_NL decoder, built by the bench at 66d50d91 with one decode slot.
mlx-audio at 92decb75 ran nativ-community's 4-bit conversion of the early-access checkpoint, whose weights are not the
release's (docs/adr/0034). "card" is the model card's verbatim instruction, "runtimes'" the one both runtimes write
when given none. Qwen3-ASR 1.7B in speech.cpp v0.8.8 is the comparison. CER for Japanese and WER for English as the
bench counts them, as written, so English differs from the card's normalized 3.35% on all of FLEURS.

| Set | Runtime, instruction | Error rate | Empty | RTFx | p50 s | Peak memory GiB (RSS + Metal) | Load s |
|---|---|---|---|---|---|---|---|
| FLEURS ja | NeMo-Speech.cpp, card | 5.91% | 0 | 4.7 | 1.89 | 18.5 | 12.4 |
| FLEURS ja | NeMo-Speech.cpp, runtimes' | 6.23% | 0 | 4.8 | 1.88 | 18.7 | 14.4 |
| FLEURS ja | mlx-audio (early access), card | 6.01% | 0 | 7.0 | 1.29 | 36.2 | 6.8 |
| FLEURS ja | mlx-audio (early access), runtimes' | 5.74% | 0 | 8.5 | 1.03 | 36.2 | 5.6 |
| FLEURS ja | Qwen3-ASR 1.7B, speech.cpp | 5.93% | 0 | 12.7 | 0.70 | 2.3 | 15.8 |
| Common Voice ja | NeMo-Speech.cpp, card | 30.24% | 17 | 4.3 | 0.87 | 18.2 | 13.7 |
| Common Voice ja | NeMo-Speech.cpp, runtimes' | 30.68% | 17 | 4.1 | 0.91 | 18.5 | 9.2 |
| Common Voice ja | mlx-audio (early access), card | 12.68% | 0 | 4.7 | 0.73 | 36.1 | 6.1 |
| Common Voice ja | mlx-audio (early access), runtimes' | 122.87% | 0 | 4.5 | 0.56 | 36.2 | 5.9 |
| Common Voice ja | Qwen3-ASR 1.7B, speech.cpp | 10.95% | 0 | 11.5 | 0.27 | 2.2 | 0.5 |
| FLEURS en | NeMo-Speech.cpp, card | 8.87% | 0 | 5.4 | 1.38 | 18.4 | 7.6 |
| FLEURS en | NeMo-Speech.cpp, runtimes' | 8.50% | 0 | 5.3 | 1.41 | 18.3 | 13.4 |
| FLEURS en | mlx-audio (early access), card | 11.21% | 2 | 10.2 | 0.74 | 36.1 | 4.9 |
| FLEURS en | mlx-audio (early access), runtimes' | 8.54% | 0 | 9.8 | 0.77 | 36.2 | 5.8 |
| FLEURS en | Qwen3-ASR 1.7B, speech.cpp | 7.49% | 0 | 13.7 | 0.51 | 2.3 | 0.6 |

Common Voice dropped one clip in which the VAD found no voice, for every runtime.

- **NeMo-Speech.cpp left 17 of the 99 Common Voice clips empty without decoding them**, with either instruction, in
  0.04 s each: its speaker branch heard no one in the clip, and at 66d50d91 a request without a voice ends at the
  encoder. The clips are 3.9 to 5.1 s of clear speech. Given as recorded, with their silence, three of them were
  transcribed; trimmed as the bench trims them, two of the three stayed empty. Over the 82 clips it decoded, its CER
  was 12.03% with the card's instruction and 12.58% with the runtimes'.
- **mlx-audio answered two English utterances with nothing** (12.0 and 13.5 s of clear speech) with the card's
  instruction, ending at the first token, and transcribed both whole with the runtimes'; over the other 98 its WER was
  8.95%. NeMo-Speech.cpp, on the release's weights, left none empty with either.
- **mlx-audio looped once.** With the runtimes' instruction, an 8.1 s Common Voice clip came back as Vietnamese words
  repeated for 1,024 tokens (2,658 characters, 20 s), which alone makes the set's CER 122.87%; without it the CER is
  12.29%. With the card's instruction it wrote two other Japanese clips in Vietnamese and in romanized Japanese. The
  model is told no language: both instructions keep it "as spoken".
- **mlx-audio's memory peaks at about twice its weights.** Its peak was 34 to 36 GiB of Metal memory, dirty and
  compressed, on a machine of 32 GB, and 18 GB while it transcribed; the system's swap held 12.7 GB while it ran.
  Its speed varied by up to 40% between two runs of the same set (RTFx 6.0 and 7.0 on FLEURS ja). NeMo-Speech.cpp
  holds its 22 GB of files and its KV pool as resident memory, 18.2 to 18.7 GiB.
- **Greedy decoding gave the same texts twice**: the mlx-audio runs made again under new ids scored the same to the
  hundredth of a point.
- NeMo-Speech.cpp's first request on Common Voice took 0.09 to 0.24 s because the first clip was one it did not decode.
