# Speech recognition on the Common Voice 8.0 Japanese test split, 2026-10-03

All 4,483 clips of the test split, as recorded, decoded from MP3 to 16 kHz with mpg123-decoder 1.0.3 (docs/adr/0016),
Q8_0 weights, on the Windows test machine: Windows 11 (build 26200), Core i9-9900K, 32 GB, GeForce RTX 2080 with
Vulkan. Qwen3-ASR ran in llama.cpp b11246, the others in CrispASR v0.8.38. The error rates are CER as written
(docs/adr/0015) and with the accepted spellings of `spellings/common-voice-8-ja-JP.jsonl` (docs/adr/0013), over
93,471 characters of reference.

| Model | CER | CER, accepted spellings | Median wait | p90 wait |
|---|---|---|---|---|
| Qwen3-ASR 1.7B | 9.25% | 4.56% | 0.19 s | 0.30 s |
| Qwen3-ASR 0.6B | 11.77% | 6.88% | 0.12 s | 0.18 s |
| parakeet-tdt_ctc-0.6b-ja | 9.26% | 4.55% | 0.20 s | 0.30 s |
| ReazonSpeech NeMo v2 | 14.00% | 9.26% | 0.27 s | 0.45 s |

No model returned an empty result. The accepted spellings lowered the errors of 1,596 to 1,666 of the 4,483 clips,
depending on the model.

The CER as each kind of accepted spelling is added in turn: the kana of the readings, then the other spellings in
digits, then every other spelling and the stretches that may be left out.

| Model | As written | Readings | Digits | All |
|---|---|---|---|---|
| Qwen3-ASR 1.7B | 9.25% | 7.04% | 6.97% | 4.56% |
| Qwen3-ASR 0.6B | 11.77% | 9.27% | 9.21% | 6.88% |
| parakeet-tdt_ctc-0.6b-ja | 9.26% | 6.80% | 6.38% | 4.55% |
| ReazonSpeech NeMo v2 | 14.00% | 11.42% | 11.02% | 9.26% |

- Every model wrote 私 for the わたし of the sentences, in 130 to 135 clips; it is the other spelling taken most
  often by all four. The Qwen3-ASR models also wrote 昨日, 明日, 今日 and ご飯 for the kana of the sentences.
- parakeet and ReazonSpeech write numbers in digits (1, 3, 1人), which the sentences write in kanji; Qwen3-ASR
  writes them in kanji as well, so digits lowered its rate by 0.07 points or less.
- As written, Qwen3-ASR 1.7B and parakeet are 0.01 points apart, and with accepted spellings too.
- The 4,483 WAVE files decoded on the Apple M5 and on this machine have the same sha256, every one of them.
- Qwen3-ASR 1.7B on the M5 (Metal) with the clips trimmed to the voice Silero VAD finds, 0.2 s around it, had
  9.29% and 4.62% over the 4,479 clips with voice; 4 clips had none. The other three models were not measured on
  the M5: two runs of Qwen3-ASR 0.6B stopped with `read ECONNRESET` from llama-server while other work loaded the
  machine, with 9 of its 10 GB of swap in use.
