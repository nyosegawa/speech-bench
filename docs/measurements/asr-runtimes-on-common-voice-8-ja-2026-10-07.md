# Speech recognition in speech.cpp v0.7.0 and the other runtimes, Common Voice 8.0 Japanese, 2026-10-07

All 4,483 clips of the Common Voice 8.0 Japanese test split, as recorded, decoded to 16 kHz with mpg123-decoder 1.0.3
(docs/adr/0016). Every model ran on the Windows test machine in one campaign, one after another, on the same night:
Windows 11 (build 26200), Core i9-9900K, 32 GB, GeForce RTX 2080 with Vulkan. Qwen3-ASR ran in llama.cpp b11246 with
ggml-org's files and in speech.cpp v0.7.0 with its own (docs/adr/0008). The NeMo models ran in CrispASR v0.8.38 with
its Q8_0 files and in speech.cpp v0.7.0 with its F16 files. Both runtimes were given the same language, `ja`: it
steers Qwen3-ASR in both as the prefix `language Japanese<asr_text>` of the answer, and the NeMo models take none. The
error rates are CER as written (docs/adr/0015) and with the accepted spellings of
`spellings/common-voice-8-ja-JP.jsonl` (docs/adr/0013), over 93,471 characters of reference. The wait runs from the
request to the text, the load excluded.

| Model | Runtime | Weights | CER | CER, accepted spellings | Median wait | p90 wait | Load |
|---|---|---|---|---|---|---|---|
| Qwen3-ASR 1.7B | llama.cpp b11246 | Q8_0 | 9.25% | 4.56% | 0.192 s | 0.303 s | 3.2 s |
| Qwen3-ASR 1.7B | speech.cpp v0.7.0 | Q8_0 | 9.40% | 4.52% | 0.203 s | 0.350 s | 2.2 s |
| Qwen3-ASR 0.6B | llama.cpp b11246 | Q8_0 | 11.77% | 6.88% | 0.121 s | 0.182 s | 4.2 s |
| Qwen3-ASR 0.6B | speech.cpp v0.7.0 | Q8_0 | 11.77% | 6.88% | 0.126 s | 0.215 s | 2.3 s |
| parakeet-tdt_ctc-0.6b-ja | CrispASR v0.8.38 | Q8_0 | 9.26% | 4.55% | 0.202 s | 0.309 s | 3.5 s |
| parakeet-tdt_ctc-0.6b-ja | speech.cpp v0.7.0 | F16 | 7.47% | 2.78% | 0.075 s | 0.126 s | 0.9 s |
| ReazonSpeech NeMo v2 | CrispASR v0.8.38 | Q8_0 | 14.00% | 9.26% | 0.279 s | 0.454 s | 3.2 s |
| ReazonSpeech NeMo v2 | speech.cpp v0.7.0 | F16 | 9.17% | 4.34% | 0.192 s | 0.304 s | 0.8 s |

No model returned an empty result. The llama.cpp and CrispASR rates equal those of 2026-10-03
(asr-on-common-voice-8-ja-2026-10-03.md) to the hundredth of a point.

- **Qwen3-ASR is as accurate in both runtimes.** The 0.6B model has the same rates in both, and the 1.7B model's
  differ by 0.15 points as written and 0.04 with accepted spellings, in opposite directions. Their texts differ on 729
  clips of the 1.7B model and 913 of the 0.6B model. Of those, by the edit distance of each to the reference:
  - 1.7B: speech.cpp's is the closer on 340, llama.cpp's on 271, and neither on 118.
  - 0.6B: llama.cpp's is the closer on 364, speech.cpp's on 305, and neither on 244.
  Most differences are of notation, such as 三ヶ月 and 3ヶ月 or a comma left out. speech.cpp writes the official
  prompt and audio tokens, where llama.cpp's prompt has no system turn and its last chunk of audio adds tokens from
  zero padding. On these clips, 4.78 s at the median and 90% of them within one 8 s window of the encoder, that
  changes no rate. No text ran on past its reference: speech.cpp's longest was 1.88 times its reference's length.
- **Qwen3-ASR waits a little longer in speech.cpp on the RTX 2080**: 5% at the median and 15% at the 90th
  percentile. Its load is shorter.
- **The NeMo models are more accurate and faster in speech.cpp.** parakeet-tdt_ctc-0.6b-ja falls from 9.26% to
  7.47% as written and waits 0.075 s at the median against 0.202 s. ReazonSpeech NeMo v2 falls from 14.00% to 9.17%
  and waits 0.192 s against 0.279 s. The weights differ, F16 in speech.cpp and Q8_0 in CrispASR, so part of the
  difference may be the weights rather than the runtime. speech.cpp decodes as NeMo's `transcribe()` does by
  default: parakeet with its TDT decoder, ReazonSpeech with its RNN-T beam search. On the first ten clips, CrispASR's
  ReazonSpeech added a filler such as あっ。 or うん。 that the audio does not hold on four.
- With speech.cpp, parakeet-tdt_ctc-0.6b-ja is the most accurate and the fastest model of this set on read speech.
  Common Voice holds sentences read aloud; this does not measure conversational speech.
