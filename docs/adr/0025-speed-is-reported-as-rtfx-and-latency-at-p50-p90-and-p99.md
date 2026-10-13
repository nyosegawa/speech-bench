# Speed is reported as RTFx, and latency at p50, p90 and p99

The report and the web app give a run's speed as RTFx: the duration of the audio heard, or of the speech made, over
the time taken, each summed over the set, so that a larger figure is faster. NVIDIA's NeMo and NeMo-Speech.cpp and
Hugging Face's Open ASR Leaderboard report recognition speed this way, and a run of the bench reads beside theirs
without turning a figure over. The time to transcribe an utterance and the time to a sentence's first audio are given
at the 50th, 90th and 99th percentiles, each by the nearest rank, so that every figure is a time that was measured; in
a set of fewer than 100 items the 99th percentile is the slowest item.

Both are computed when a report is made, from the times and durations every result file keeps, so a run of any format
reads the same way and nothing in `run.jsonl` changes.

## Rejected

- **RTF, the time over the duration**, which the bench reported first. It is the inverse of what the runtimes it is
  compared with publish, and a smaller figure being faster reads the wrong way beside them.
- **Storing the figure in the result file.** It is derived from what the file already holds, and a stored copy could
  disagree with it.
- **Interpolated percentiles.** They give times no item took, and with 20 sentences the 99th would sit between the
  two slowest.
