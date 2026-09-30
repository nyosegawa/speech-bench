# Speech recognition on the author's recordings, 2026-09-30

The 31 prompts of `prompts/record-ja-JP.json`, read by the author on an Apple M5 MacBook Pro, recorded at
16 kHz without echo cancellation, noise suppression or automatic gain, cut and leveled the way the bench
prepares a capture (hangover 600 ms), Q8_0 weights, on an Apple M5 with macOS 26.2. The error rate is CER
over the utterances the model heard, with Japanese numbers read as digits.

| Model | Dropped by VAD | CER | Empty | Median wait |
|---|---|---|---|---|
| Qwen3-ASR 1.7B | 1 | 8.83% | 0 | 0.34 s |
| parakeet-tdt_ctc-0.6b-ja | 1 | 11.17% | 0 | 0.08 s |
| ReazonSpeech NeMo v2 | 1 | 17.93% | 0 | 0.08 s |

- Most of the errors are in the requests that mix in English and product names. Qwen3-ASR writes GitHub,
  TypeScript and AWS correctly and misses Claude Code, CI and 渋谷; parakeet-ja and ReazonSpeech write them
  in katakana or as other words (ギター部 for GitHub).
- The author's はい has 234 ms of voice, under the 250 ms ASIST's VAD requires, and is dropped for every
  model.

## The level of the recordings

| Room | Louder frames of speech | Loudest sample |
|---|---|---|
| −64 dBFS | −32 dBFS | −22 dBFS |

The room is the 10th percentile and the louder frames the 95th percentile of the 20 ms RMS of each
recording; each figure is the median over the 31 recordings.

- At the level recorded, ASIST's energy gate opens for 30 of the 31. Its fixed lower threshold is an RMS of
  0.012 (about −38 dBFS). ASIST's input passes through automatic gain, which these recordings do not have
  (asist-input-levels-2026-09-30.md).
- The bench scales each recording to a peak of 0.9 before its VAD (docs/adr/0001), which raises the room as
  much as the voice. The author's loudest sample is 41 dB above the room, so the room is raised to about
  −42 dBFS, below the RMS of 0.024 (−32 dBFS) that the VAD's initial noise floor still takes for silence. A
  recording whose loudest sample is nearer its room has its room raised to that level and is sent whole,
  with its silence. Starting the noise floor settled on the room does not help, since ASIST's floor does not
  move while a capture is open, and letting the floor follow every quiet frame cut speech out of FLEURS
  (Qwen3-ASR's CER rose from 5.31% to 15.94%). A level that stands in for ASIST's input has to come from
  measuring that input.
