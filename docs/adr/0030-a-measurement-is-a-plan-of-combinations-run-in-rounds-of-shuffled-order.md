# A measurement is a plan of combinations, run in rounds of shuffled order

A measurement that compares builds of speech.cpp, runtimes and models is written as a plan (`plan` format 1): a
campaign, a number of rounds and entries, each of which names models with the builds, devices, seeds, set and load
they are run with. `node src/cli.ts plan` expands the entries into combinations, one model in one build, on one device
and, for synthesis, with one seed, and runs each combination once a round. A build applies to the speech.cpp entries
alone; a model of another runtime in the same entry runs once, in its pinned release, so that one entry puts a build of
speech.cpp beside the runtimes it is compared with. speech.cpp's releases the bench pins (v0.8.2, which runs by
default, and v0.8.4) are named by their tags, as builds of its CI and local builds are named.

Each round runs the combinations in an order of its own, shuffled by a generator seeded with the campaign and the
round. What the machine does over a measurement, its heat, other programs and the file cache, then falls on every
combination alike rather than on the one that always runs first or after the same one. The order is the same each
time the plan runs, so a plan resumed runs what is left in the order it was planned.

Every run records the combination it was made for, written out in full, and its round (result format 19), and joins
the plan's campaign. What is done is read from those runs: running a plan again makes only the combinations and rounds
the campaign has no run for. The plan checks every combination before the first runs, so that one that cannot run
stops it before anything is measured, and a run that fails stops the plan.

## Rejected

- **A file of the plan's progress beside the campaign.** It would be a second record of what the runs already say,
  and could disagree with them when a run is removed.
- **Matching runs to combinations by their fields** (model, runtime, device, seed). A build is recorded by the version
  and commit it reports, not by the name the plan gives it, and a round cannot be told from a run.
- **Rounds of the same order**, or every round of one combination at once. The first leaves a combination always
  after the same one, the second puts all of its runs at one time of the measurement.
- **A random order drawn anew on every run of the plan.** A resumed plan would run the rest of a round in another
  order than the one it started in.
