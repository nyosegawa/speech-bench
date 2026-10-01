# A run is kept in a folder of its own, with its analysis

Every run is kept in `runs/<run>/` of the data folder: its result file `run.jsonl`, for synthesis the WAVE file
of each sentence beside it, and `analysis.json`, what was read from that speech (the voice in each take, its
median pitch and its speaker embedding). The result file is what was measured; the analysis is made from it
and the speech as the run ends, kept so that it is not made again, and made again when the speaker model or the
analysis changes. Made when a page first asked for it, the analysis kept the page waiting: the chosen voices of
2026-10-01, 640 takes, took 225 s on an Apple M5, against about 6 s for a run of 20 sentences at its end. A campaign, `campaigns/<name>.json`, names the runs of one experiment, which a run joins when it is
made with `--campaign`.

The earlier layout kept 1,269 files side by side in `results/`, a result file next to a folder of speech
named after it, and the runs of one experiment were found again by their file names. Reading the speech of
40 runs again for each listening page took 5 minutes on an Apple M5, almost all of it embedding and pitch.

## Rejected

- **The analysis in a folder apart from the runs.** Removing or moving a run would leave its analysis behind.
- **A database of runs.** The result files are the record and are read by hand and by other tools; a
  database would be a second copy to keep in step with them.
- **Choosing the runs of an experiment by their file names.** The names say how a run was made, not why, and
  two experiments with the same settings could not be told apart.
