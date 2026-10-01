# AGENTS.md

## Project

speech-bench measures local speech models (speech recognition and speech synthesis) under one set of
conditions, across the runtimes they run in and the machines they run on (macOS arm64 with Metal, Windows x64
with Vulkan), so that speech.cpp takes up a model on numbers and a port can be checked against the model it
came from. It also makes voices for models without built-in ones. It serves no one application: an
application's own conditions, such as its VAD, stay out of it. It is a TypeScript command-line tool on Node
22.18 or later, tested with Vitest. README.md is the documentation
for users; `docs/adr/` keeps the decisions. Read the relevant implementation and tests before changing
behavior.

## Architecture

- `src/cli.ts` is the entry; it and `src/cli/` parse the commands and nothing else, one file for each group
  of commands (measuring, voices, the web app).
- `src/core/` holds what every part reads: WAVE files and resampling (`wav.ts`), the data folder
  (`paths.ts`), the system and machine (`platform.ts`, decided once, so the rest never checks the system
  itself) and BCP 47 tags (`language.ts`).
- `src/catalog/` lists the models with their pinned files, their runtimes and the languages of their model
  cards (`models.ts`), pins the releases of the runtimes (`runtimes.ts`), and fetches and verifies pinned
  files (`store.ts`, `download.ts`).
- `src/engines/` holds one engine per runtime. An engine starts its process, transcribes an utterance or
  speaks a sentence, and stops; it knows nothing about datasets or scoring. The models run in this process
  through sherpa-onnx (speaker embeddings, Silero VAD) are engines too. `adapters/` holds the adapters that run a
  model's official implementation behind speech.cpp's worker protocol, each a uv project with a lock file;
  `src/engines/adapter.ts` installs and starts them.
- `src/datasets/` turns a source (FLEURS, the user's recordings, the prompt lists) into utterances with
  references or sentences to speak.
- `src/measure/` runs a model over a set and writes the result (`run-asr.ts`, `run-tts.ts`), owns the form of
  result files and their upgrades (`results.ts`), where a run is kept (`runs.ts`), the campaigns
  (`campaigns.ts`), the scoring of texts (`scoring.ts`) and the report (`report.ts`).
- `src/analysis/` reads speech: speaker embeddings and their comparisons (`speaker.ts`), pitch (`pitch.ts`),
  sets of takes of one voice (`neighbors.ts`), and the analysis kept beside a run (`run-analysis.ts`).
- `src/make/` makes voices: the recipes in `prompts/voices-<locale>.json` (`recipes.ts`), the steps from
  takes to a chosen reference (`voice.ts`) and the reference voices (`references.ts`).
- `src/pages/` builds the data of the listening and voices pages.
- `src/web/` is the web app's server: its JSON API (`api.ts` holds the types the app reads), the audio of
  the data folder, saving recordings, and the jobs it runs. `web/` is the app itself, in React with Tailwind CSS 4 and shadcn/ui, built with Vite; it
  imports only types from `src/`, through `@bench/`.

Keep these boundaries explicit: code does not reach past its module for an operation that belongs to
another one.

## Code

- TypeScript runs through Node's type stripping: only erasable syntax (no enums, namespaces or constructor
  parameter properties), and imports name the `.ts` file.
- Persist each fact in one authoritative place and derive secondary views instead of synchronizing
  copies, unless forcing it into one place would distort the design more than the copies would.
- Do not add fallback behavior; fail loudly rather than degrade silently. A measurement that cannot be
  trusted stops the run: a server that does not start, a model loaded as another backend, a locale the
  model does not list, a WAVE format that is not understood.
- Fix a defect where its cause is, in a form in which it cannot happen, rather than with a guard for the
  one case that showed it; the code after the fix reads better than before. When a fix is much larger
  than the defect, or needs a choice only the user can make, stop and ask instead of patching.
- Every download is pinned: a release by URL and sha256, a Hugging Face file by repository, revision,
  size and sha256. A file is renamed into place only after its hash matches.
- A result file carries the version of its form (`format` in its run line). Any change to the form, an
  added field included, raises the version, adds an upgrade from the previous version, and adds a sample
  of the new version to `tests/fixtures/`. Upgrades are never removed.
- A model lists the languages of its model card as BCP 47 tags. A tag without a region covers every
  region of the language.
- Extract code only when it creates a coherent responsibility, a reusable boundary or an independently
  testable unit. Introduce a shared abstraction only after two current implementations show the same
  responsibility with meaningful variation.
- A file approaching 500 lines calls for a review of its responsibilities; split it when a coherent one
  can be extracted, not to meet a line count.
- Code never splits a path or tests it as text with `/`; it uses `node:path`. Names inside archives and
  on Hugging Face are not paths of this system and keep their `/`.
- Start every child process with `windowsHide: true`.
- Downloads, recordings, logs and results live under the data folder (`~/speech-bench-data`,
  `SPEECH_BENCH_DATA`), never in the repository. A recording of someone's voice is never committed. Never
  commit `.env`, `node_modules/`, coverage or build caches either.

## Comments

- Write comments in English, in full sentences and the present tense. Other languages appear only as
  data, quoted verbatim.
- Say only what the code cannot: an API quirk and the failure it causes, a measured value with its
  condition and date, a constraint, or why the simpler approach was rejected. Do not restate names,
  narrate steps, or mention history, TODOs, docs, tickets or conversations.
- Doc comments on exported and non-obvious module-level declarations, without parameter or return tags.
  A file header, if any, goes after the imports.
- Inside a function, a comment goes on its own line above the code. No trailing comments and no banner
  comments (`/* ---- section ---- */`).

## Tests

- Add or update tests for behavioral changes, especially scoring, audio handling, the result format and
  the contracts with the runtimes.
- A failing test points to a defect. A test does not fail on a deliberate change of wording, a name or a
  configured value, and does not only assert that something exists or is gone.
- Tests protect current behavior or a safety boundary, not the shape of removed code.
- Test names are English. Other languages in a test are fixture data.
- Tests never download: anything a test needs from a model or a dataset is a small fixture in `tests/`.

## Text

- The output of the commands, README.md and AGENTS.md are English. Japanese and other languages appear
  only as data: references, transcriptions and utterances.
- An error message names what failed and what to do, and includes the log file of the server when there
  is one.

## Decisions

`docs/adr/` keeps the decisions the code cannot show, one file each, and the file names say which behavior
each covers. Before changing how a measurement behaves, list the folder and read only the records whose
names cover that behavior; if the change contradicts one, say so to the user first. Before committing, ask
whether the work settled a choice or turned an approach down for good; if so, the record goes into the
same commit.

A design document under `docs/` holds only what the code cannot show: the reasons for a decision and
measured values. It does not restate types, APIs or steps the code already shows, and no code or comment
refers to it. Something that can be checked is checked and written as a fact, not left open.

## Workflow

- Run `npm run typecheck` and `npm test` before committing code.
- Never commit on main. Every change reaches main through a pull request, one coherent unit each: a
  feature, fix, refactor or documentation change. Do not let unrelated changes pile up in one branch.
- Commit messages and pull request titles are one English sentence in the imperative, without a prefix
  such as `feat:`; the body says what changed and why.
- The user merges pull requests, with a squash, once CI passes. An agent merges only when told to.
- When a change alters what a user does or sees, update README.md in the same change.
