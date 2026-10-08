# A CI build of speech.cpp runs by its run id, checked against GitHub

A release candidate is also measured on machines with no build environment, the Windows machine with the RTX 2080
among them, where none is to be installed. speech.cpp's workflow `build` packs on every run the archive a tag would
release, `speech-<VERSION>-<system>.zip`, and uploads it as the artifact `speech-<system>`. `SPEECH_BENCH_SPEECH_CPP`,
which names a local build (docs/adr/0019), also takes a run of that workflow as `ci:<run id>`, and every run that would
start the release's `speech` starts the run's instead.

For each use the bench asks GitHub through `gh` for the run and takes it only when it is a run of `build` for a push or
one started by hand, and the job that packs the archive for the system (`windows-vulkan`, `macos-metal`) passed. The
commit is the run's head. The first use downloads the artifact's zip with `gh api`, keeps it only when its sha256 is
the digest GitHub gives, unpacks the one archive inside it, and keeps the build in `runtimes/speech.cpp-ci-<run id>`
once `speech --version` reports the release number the archive's name gives. A result records that number as the
runtime's version and `build: { commit, ciRun }` (result format 14, where format 13's `localBuild` becomes `build` with
`ciRun: null`); the report and the pages write it as `speech.cpp 0.7.1, CI build f5ab84c1710d (run 37705728430)`, so
that two runs of one commit are told apart. Voice files made by a CI build are kept by its run, apart from those of a
local build of the same commit.

## Rejected

- **A folder of an archive unpacked by hand, with its commit given beside it.** Nothing in the archive names its
  commit, since `speech --version` prints the release number alone, so the bench would record whatever commit it was
  told.
- **A run of a pull request.** Its checkout builds the merge of the branch into its base, `refs/pull/<n>/merge`, a
  commit no branch keeps and the run does not report, so its head is not what was built. The workflow is started by
  hand on the branch instead (`gh workflow run build -R nyosegawa/speech.cpp --ref <branch>`).
- **The whole run passing.** A run is taken when the job that packed the system's archive passed, since a job of
  another system or the installer's failing does not change that archive.

## Known limits

- GitHub serves an artifact only to a signed-in user, also of a public repository (HTTP 401 without a token,
  2026-10-08), so the machine that measures needs GitHub CLI logged in, and the network for each run.
- An artifact expires 90 days after its run (speech.cpp's run 37705728430, 2026-10-08); a build already downloaded
  keeps running, and a later one is measured from a new run of the same commit.
- A CI build is built with `GGML_NATIVE=OFF`, as a release is, and a local build may not be, so the two can differ in
  speed on one machine; the results tell them apart.
