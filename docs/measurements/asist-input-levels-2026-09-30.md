# What ASIST's VAD receives, 2026-09-30

Four `asist-input` sessions of the author's with ASIST 0.3.1 (with the per-capture log of the
`vad-soft-voices` branch) on an Apple M5 MacBook Pro with macOS 26.2, in the same quiet room as the
recordings of `asr-on-the-authors-recordings-2026-09-30.md`. The built-in microphone played the assistant
through the Mac's speakers; the Bluetooth sessions used Bose QC Ultra Earbuds for input and output, which ran
at 16 kHz with 3 channels in their hands-free profile. The native capture is macOS voice processing with
DeepFilterNet after it; getUserMedia had echo cancellation, noise suppression and automatic gain on. A
getUserMedia session stopped after eight items (`20260930-232724`) is left out.

## Levels

The gain is how much louder ASIST's input was than the raw recording of the same prompt: the 95th
percentile of the frames Silero took for a voice, against the 95th percentile of the recording's 20 ms RMS,
as the median and the range over the prompts both have (short answers, requests, a filler and a long
utterance; the softer and farther ones left out). The voice is the range of that percentile over the same
prompts; the room is the 10th percentile of the frames in the silent items.

| Microphone | Capture | Gain | Voice | Room |
|---|---|---|---|---|
| built-in | native | +18.7 dB (16.1 to 20.5) | −11.7 to −16.5 dBFS | −149 dBFS |
| built-in | getUserMedia | +12.6 dB (3.4 to 15.6) | −16.8 to −26.4 dBFS | −68 dBFS |
| Bluetooth | native | +11.7 dB (5.2 to 16.2) | −16.1 to −27.6 dBFS | digital silence |
| Bluetooth | getUserMedia | +12.9 dB (5.9 to 21.9) | −12.7 to −26.8 dBFS | digital silence |

- Every voice cleared ASIST's fixed lower threshold (−38.4 dBFS) by 10 dB or more.
- Scaled by these gains, and by 12 dB less, the raw recordings lose only 「はい」 to ASIST's energy gate with
  ASIST's values of the day; with 100 ms voiced and 30 ms confirmed by Silero, all 31 are kept. Silero is
  left out of this replay.
- The 95th percentile of the assistant's echo while it replied was −54 dBFS through the native helper and
  −53 dBFS through getUserMedia on the built-in microphone, and −94 and −73 dBFS on the earbuds; Silero
  took at most 2% of it for a voice (`input-report`).

## Captures

- The short answers ASIST's values of the day dropped, in normal voice, had 128 to 320 ms voiced and 43 to
  192 ms confirmed by Silero.
- Silero confirmed nothing of typing, a knock on the desk or a cup set down in any session. Qwen3-ASR 1.7B
  wrote 「うん。」 for every cough and cleared throat it was given.
- An interruption while the assistant spoke was kept in both native sessions and dropped in both
  getUserMedia sessions, where Silero confirmed none of it and most of it stayed under the playback
  threshold of −28.9 dBFS, although its loudest frames reached −28 and −15 dBFS.
- On the earbuds through getUserMedia, the input was all zeros for 4.3 s after a reply ended, which cut
  one request.
