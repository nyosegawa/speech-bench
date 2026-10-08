# A release candidate of speech.cpp runs from a local build its results name by commit

The bench runs speech.cpp's pinned release. A release candidate is measured before it is released, so that a
regression can still be fixed, from a local build: `SPEECH_BENCH_SPEECH_CPP` names a CMake build directory of
speech.cpp, and every run that would start the release's `speech` starts the build's instead, for recognition, for
synthesis and for the voice files synthesis needs. The other runtimes stay pinned.

The bench takes the directory only when its `CMakeCache.txt` names the project `speech-cpp`, the build is Release
(speech.cpp builds Release when the type is left empty), the source the cache names is a git checkout whose tracked
files have no changes that are not committed, and `speech --version` prints speech.cpp's version. A result records
the release number the build reports as the runtime's version and the commit of its source as `localBuild` (result
format 13; `build` with `ciRun: null` from format 14, docs/adr/0022); a run of a release has no local build, and every
run of format 12 ran a release. The report and the
pages write such a runtime as `speech.cpp 0.7.1, local build 596b8d83f166`. Voice files made by a local build are
kept by its release number and commit, apart from the release's.

## Rejected

- **A flag on `asr` and `tts`.** A variable reaches every command that starts speech.cpp, the voice steps and the web
  app's jobs among them, as `SPEECH_BENCH_DATA` and `SPEECH_BENCH_DEVICE` do, without each command passing it on.
- **The release number alone.** speech.cpp's main branch reports the number of the release before it until the
  version is raised (0.7.1 on 2026-10-08, three commits after v0.7.1), so its runs would read as the release's.
- **A source with changes that are not committed, recorded as changed.** A result has to name what was measured, and
  only a commit does.
- **The bench building a pinned commit of speech.cpp itself.** Building needs CMake, a compiler and, on Windows, the
  Vulkan SDK on every machine that measures, which the bench needs nowhere else, and a candidate is built again for
  every fix.

## Known limits

- Whether the executable was built after the source's last checkout cannot be told from the build directory: an
  executable built before a `git pull` is taken for the new commit. The build is made just before the measurement.
