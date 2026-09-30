# Speech recognition on an Apple M5, 2026-09-30

The first 100 utterances of the FLEURS test split of each locale, cut and leveled the way ASIST prepares
a capture (hangover 600 ms), Q8_0 weights, on an Apple M5 with 32 GB and macOS 26.2 (Metal). Qwen3-ASR ran
in llama.cpp b11246, the others in CrispASR v0.8.38 with its language detection turned off. The error rate is CER for Japanese and Korean and WER
for the other languages, with Japanese numbers read as digits (docs/adr/0002). The wait is the time from sending the whole utterance to receiving its text.

| Locale | Model | Error rate | Median wait | p90 wait |
|---|---|---|---|---|
| ja-JP | Qwen3-ASR 1.7B | 5.31% | 0.70 s | 1.21 s |
| ja-JP | parakeet-tdt_ctc-0.6b-ja | 8.18% | 0.18 s | 0.36 s |
| ja-JP | ReazonSpeech NeMo v2 | 7.32% | 0.21 s | 0.37 s |
| en-US | Qwen3-ASR 1.7B | 4.18% | 0.58 s | 0.88 s |
| en-US | parakeet-tdt-0.6b-v3 | 5.74% | 0.12 s | 0.16 s |
| fr-FR | Qwen3-ASR 1.7B | 5.22% | 0.85 s | 1.25 s |
| fr-FR | parakeet-tdt-0.6b-v3 | 5.26% | 0.12 s | 0.17 s |
| de-DE | Qwen3-ASR 1.7B | 3.37% | 0.93 s | 1.24 s |
| de-DE | parakeet-tdt-0.6b-v3 | 5.66% | 0.13 s | 0.18 s |
| it-IT | Qwen3-ASR 1.7B | 2.73% | 0.93 s | 1.24 s |
| it-IT | parakeet-tdt-0.6b-v3 | 2.47% | 0.14 s | 0.19 s |
| es-419 | Qwen3-ASR 1.7B | 2.45% | 0.83 s | 1.35 s |
| es-419 | parakeet-tdt-0.6b-v3 | 2.82% | 0.11 s | 0.18 s |
| pt-BR | Qwen3-ASR 1.7B | 4.48% | 0.83 s | 1.53 s |
| pt-BR | parakeet-tdt-0.6b-v3 | 4.76% | 0.14 s | 0.20 s |
| ko-KR | Qwen3-ASR 1.7B | 2.67% | 0.92 s | 1.31 s |
| hi-IN | Qwen3-ASR 1.7B | 13.98% | 1.94 s | 3.24 s |
| id-ID | Qwen3-ASR 1.7B | 4.81% | 0.72 s | 1.20 s |

- parakeet-tdt-0.6b-v3 waited a fifth to a seventh as long as Qwen3-ASR 1.7B in every European locale. It
  was as accurate in French, Italian, Spanish and Portuguese (within 0.4 points), and less accurate in
  English (1.6 points) and German (2.3 points).
- No model returned an empty result on these utterances, although each ends with the 600 ms hangover
  silence ASIST keeps.
- Hindi is the slowest and least accurate language for Qwen3-ASR: it writes Devanagari in more tokens, and
  its median wait is more than twice that of the other languages.
- FLEURS has no Spanish of Spain, so es-ES is not measured.
- These are read Wikipedia sentences. They say nothing about short answers, names, technical words or
  fillers, which the user's own recordings are for.
- CrispASR detects the language with Whisper tiny before every transcription unless it is turned off. The
  first CrispASR runs included that detection, which made their waits 0.04 to 0.08 s longer at the median
  and left the error rates exactly as they are here.
