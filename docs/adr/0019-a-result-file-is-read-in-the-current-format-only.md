# A result file is read in the current format only

The bench reads result files of the current format and refuses any other. When the form of a result file
changes, the results already in the data folders are rewritten to the new form by a script run once outside
the repository, and the code keeps no upgrade from an earlier format.

The results live only in the data folders of the machines that measured them, not in the repository or on
Hugging Face, so every copy can be rewritten when the form changes. Until format 11 the bench kept an
upgrade from every earlier format, a sample of each in `tests/fixtures/` and a command that moved the
results of an earlier layout into `runs/`: 18 samples and the tests that read them, for 680 runs on an Apple
M5 and 593 on a Windows machine that were all rewritten to format 12 on 2026-10-05.

Format 12 also names the preparation of the runs made until 2026-09-30 by what it was, an energy VAD that
kept a hangover after the voice (`energy-vad`), where format 11 named it after the application whose VAD it
copied.

## Rejected

- **Upgrading each file as it is read.** Every reader carries every earlier form, a field that no current run
  has stays in the types, and nothing ever retires an old form, since a file of it might still exist.
- **Rewriting the results with a command of the bench.** The command would be kept for a change made once,
  and would itself have to know the earlier forms.
