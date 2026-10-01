# speech-bench

Measures local speech recognition and speech synthesis models under one set of conditions, across the runtimes
they run in and the machines they run on, so that [speech.cpp](https://github.com/nyosegawa/speech.cpp) takes up
a model on numbers, and a port can be checked against the model it was ported from. It runs pinned releases
(llama.cpp, CrispASR, speech.cpp, audio.cpp) on macOS with Metal and on Windows with Vulkan. It also makes
voices for models that have none built in, from a description and lines in character.

## Requirements

- macOS on Apple Silicon, or Windows x64 with a discrete GPU
- Node.js 22.18 or later (TypeScript runs directly through type stripping)
- [uv](https://docs.astral.sh/uv/), only for the official implementations the adapters run (Irodori-TTS's)

```sh
npm install
npm --prefix web install
npm run web:build
```

## Use

```sh
# The models, and the languages each one transcribes
node src/cli.ts models

# Three models on the first 100 utterances of the Japanese FLEURS test split
node src/cli.ts asr --locale ja-JP --models qwen3-asr-1.7b,parakeet-tdt_ctc-0.6b-ja,reazonspeech-nemo-v2 --count 100

# Speech synthesis: the Japanese sentences of prompts/speak-ja-JP.json, spoken and then transcribed
node src/cli.ts tts --locale ja-JP --models qwen3-tts-0.6b,qwen3-tts-1.7b

# Irodori-TTS v4.1 in speech.cpp, which speaks like a reference voice
node src/cli.ts tts --locale ja-JP --models irodori-tts-v4.1-small-mf,irodori-tts-v4.1-small-16steps --reference voice-bright-young-woman --seeds 1

# The same in Irodori-TTS's official PyTorch runtime, to check speech.cpp's port against it (on a Mac, through uv)
node src/cli.ts tts --locale ja-JP --models irodori-tts-v4.1-small-mf-official --reference voice-bright-young-woman --seeds 1

# Ten of those sentences from each of five seeds, to hear which seed gives a voice worth keeping
node src/cli.ts tts --locale ja-JP --models irodori-tts-v4-small-16steps --seeds 1,2,3,4,5 \
  --only aizuchi-hai,aizuchi-naruhodo,reply-weather,reply-meeting,reply-sorry,number-date,mixed-github,question-which,long-plan,long-cause

# Measure on your own utterances, recorded under Record in the web app (see below)
node src/cli.ts asr --locale ja-JP --models qwen3-asr-1.7b --set recordings --speaker guest

# One table of every result so far
node src/cli.ts report

# The same ten sentences in each voice described in prompts/voices-ja-JP.json, all from seed 1
node src/cli.ts tts --locale ja-JP --models irodori-tts-v4-small-16steps --seeds 1 \
  --designs young-woman-words,young-woman-caption,young-woman-detailed --only aizuchi-hai,reply-weather,long-plan

# The web app at http://127.0.0.1:5280/: every run, and the speech of chosen runs side by side
node src/cli.ts web
```

## Data

Downloads, recordings, logs and results live outside the repository, in `~/speech-bench-data`, or in the
folder `SPEECH_BENCH_DATA` names.

```text
~/speech-bench-data/
  models/      model files from Hugging Face, by repository and revision
  datasets/    FLEURS transcriptions and audio archives
  fleurs/      the FLEURS recordings unpacked for measuring
  runtimes/    llama.cpp, CrispASR, speech.cpp and audio.cpp releases
  recordings/  your recordings, <locale>/<speaker>/manifest.jsonl
  references/  reference voices made from synthesized takes, <name>.wav and <name>.json
  voice-files/ Irodori-TTS voice files made from the references for speech.cpp, by reference and codec
  adapters/    the Python environments of the adapters
  logs/        server output
  runs/        a folder per run: run.jsonl, the speech of each sentence and analysis.json
  campaigns/   the runs of each experiment, <name>.json
```

`run.jsonl` holds what was measured, one JSON line for the run and one per utterance or sentence.
`analysis.json` holds what is read from the speech (its voice, pitch and speaker embedding). A synthesis run makes it
as it ends, so that a page does not read the speech again, and it is made again when the speaker model changes.
`node src/cli.ts analyze` makes it for the runs made before, which a page would otherwise analyze while it loads
(640 takes took 225 s on an Apple M5). `--campaign name` on `asr` or `tts` adds the run to an experiment, which
`report` and `analyze` then take with `--campaign name` and the web app's runs page filters by. Data of the earlier
layout, a result file in `results/` with its speech in a folder beside it, is moved into `runs/` by
`node src/cli.ts migrate`.

### Your own recordings

The web app's Record page starts a speaker, named in lower-case letters, digits, - and _, or continues one. It
shows the prompts of `prompts/record-<locale>.json` one by one (short answers, requests with names and technical words, numbers, mixed English, fillers and
long utterances, the kinds of speech an assistant hears), records the microphone without echo cancellation, noise
suppression or automatic gain, and saves 16 kHz WAVE files with the text that was said. The controls, the
progress and an input level meter stay at the top while a long prompt is read; each saved recording shows its
waveform, its loudest sample and the level of the room around the voice, and says when it is too quiet or
clipped. A prompt's text can be edited before recording when it will be said differently, and free recordings can
be added. Space records and stops, the arrow keys move between prompts and P plays the saved recording.

Each speaker's recordings are kept apart under the speaker's name, and each speaker is measured
as a set of their own (`--set recordings --speaker guest`), so that a model that hears one voice well and
another badly shows it. The recordings are listed in `recordings/<locale>/<speaker>/manifest.jsonl`, one
object per line, with `audio` relative to the manifest:

```json
{"id": "short-hai", "audio": "short-hai.wav", "text": "はい"}
```

## How the audio is prepared

By default each utterance is trimmed to its voice: Silero VAD finds where the voice begins and ends, the
recording is kept from `--margin` seconds before the first stretch of voice to as long after the last (0.2 s,
as far as the recording reaches), and scaled to a peak of 0.9, so that every model hears the same stretch at
the same level. An utterance in which Silero finds no voice is not sent: the result records it as dropped,
and the report counts it in its own column and leaves it out of the error rate and the timings.
`--edges as-recorded` sends the recording as it is, with `--trailing-silence` seconds of silence after it,
which shows how a model takes long silences.

## What is measured

### Speech recognition

- **Error rate**: characters (CER) for Japanese, Korean and Chinese, words (WER) for the other languages,
  after NFKC and with punctuation and symbols removed; Japanese numbers are compared as Arabic digits, so
  that 一ドル and 1ドル are equal, and a long vowel mark as the vowel it lengthens, so that あー and ああ are equal. The errors of the whole set are divided by the length of its references,
  rather than averaging the rates of single utterances. Errors are counted when a report is made, from the
  texts the result files keep, so that every result is scored by the same rules.
- **Time**: from sending the whole utterance to receiving its text, which is what a speaker waits for once
  an application's VAD has closed the utterance. The first utterance is transcribed once more, untimed, because it pays
  for the GPU's first use.
- **Empty results**: utterances that came back without text.

Recognition runs of one set, chosen on the web app's runs page, open the transcripts page: what every run heard of
each utterance, as it was scored, with what it heard for another unit, heard but was not said, and did not hear
marked against the reference, its errors beside it. It shows the utterances some run heard wrong, or those the runs
heard differently, in the set's order or the most errors first.

### Speech synthesis

- **First audio**: from sending a sentence to receiving its first audio. speech.cpp's Qwen3-TTS streams audio
  frame by frame while it generates, and its Irodori-TTS makes a sentence at once and streams it as the codec
  decodes it; audio.cpp's Irodori-TTS answers with the whole sentence, so its first audio arrives with the
  last.
- **Real-time factor**: the synthesis time over the length of the speech.
- **Heard error rate**: the speech is transcribed by Qwen3-ASR 1.7B, after the synthesis model has
  stopped, and compared with the sentence as for recognition, except that a sentence counts at most all of
  its characters as errors, so that one take that runs on cannot decide the rate of a voice. It counts
  misreadings, dropped or repeated words, and speech that runs on past the sentence.
- **Heard as said**: the sentences the recognizer heard as they were written, apart from how it spells them
  (in Japanese katakana or hiragana, small or full-size vowels, あー or ああ), but not shorter, longer or with a
  word more. A take that passes is one an application could keep, as when it makes short replies ahead of
  time and keeps the takes heard right.
- **Seconds per character**: the pace of the speech, which shows a model that rushes or runs on.
- The speech of every sentence is saved as a WAVE file in the run's folder, for listening.

A model without built-in voices (Irodori-TTS here) makes a voice up for every sentence from the seed it is
sampled with, which audio.cpp picks at random for each request. `--seeds` gives one run for each seed: audio.cpp
samples every sentence of a run from it, and speech.cpp's worker the first request, each later one the next
seed. A seed does not keep the voice:
Irodori-TTS follows the sentence more than the seed. `--designs` describes the voice in words instead, with the
descriptions of the voices in `prompts/voices-<locale>.json` (Irodori-TTS's `instruction`), one run for each.

Runtimes run as a process, speech.cpp's worker among them, are reached through speech.cpp's worker protocol
(docs/adr/0008): JSON lines, a request per line, the speech streamed back in base64 16-bit chunks. Irodori-TTS
v4.1 in speech.cpp has no voice of its own and needs `--reference`; the reference goes to the worker as a voice
file, which speech.cpp's `irodori-tts --make-voice` makes once on the CPU and `voice-files/` keeps.

A model's official implementation runs in an adapter of the bench's own that speaks the same protocol
(docs/adr/0012): `adapters/irodori-tts/` runs Irodori-TTS v4.1's official PyTorch runtime at FP32 on the Mac's
GPU, from the revisions of the checkpoints speech.cpp's GGUFs were converted from, with the reference voice given
as its WAVE file. uv installs the packages the adapter's lock file pins into `adapters/` of the data folder on the
first run, before the timing starts. The official runtime does not stream, so its first audio arrives with the
last.

On a Mac, audio.cpp's Irodori-TTS v4 Small runs its codec on the CPU. audio.cpp's Metal codec (v0.8.2) adds a distorted copy of the
voice, heard as a doubled voice with a low hum, which its CPU and Vulkan codecs do not; the CPU codec takes 4 to
7 times as long, which the Mac's times to the first audio include. The options a runtime was loaded with are
recorded with each result and shown in the report. A model with built-in voices
speaks with the voice native to the locale, or the one `--voice` names.

The web app lists every run, sortable and filtered by set, campaign and text. Synthesis runs of one set, once
chosen, open the listening page, which shows each run as a voice: its sentences play in a row, to hear whether it
stays the same voice, and each sentence plays in every voice in turn, to compare them. Voices can be starred while
listening. Blind hides the names and shuffles the voices, and says which is which at the end; otherwise the page
opens with a summary: a table of the voices, sortable and marked green or red, and a chart with a point for each
sentence of each voice, which plays it. For each voice it gives:

- **Same voice**: how alike the sentences sound, the mean cosine similarity of the speaker embeddings
  (3D-Speaker ERes2NetV2) of every pair of sentences with 1.5 s of voice or more. One real speaker's recordings
  are 0.84 alike and 0.33 like other men's, Qwen3-TTS's ono_anna 0.76, and Irodori-TTS without a description 0.47 to 0.57.
  Each sentence also shows how much it sounds like the rest, which singles out one spoken in another voice.
- **Pitch spread**: the standard deviation of the sentences' median pitch in semitones; ono_anna 1.5 to 1.8,
  Irodori-TTS without a description 3.6 to 6.6.
- What the recognizer heard, the sentences that broke down (more than 30% of their characters heard wrong),
  and the time to the first audio.

The web app's Neighbors page takes the synthesis runs chosen on the runs page, or a voice's gathered takes, groups
the takes meant to be one voice (one model with one voice or description, loaded the same way on the same GPU,
whatever the seed or sentence) and shows a map of how alike every pair is, ordered so that one voice shows as a block, each take's
nearest and farthest takes, and the largest set of takes at least a chosen similarity to one center, one take per
sentence, to be heard in a row. One voice rates a sentence it says twice about 0.07 more alike than two different
sentences (Qwen3-TTS's ono_anna, 0.82 against 0.74), so a set of one sentence said with many seeds would hold
together for the wrong reason.

`reference` makes a reference voice out of such takes: the largest set in which every pair is at least the
threshold alike (0.8 by default, which sounds like one voice by ear), one take per sentence, joined in order of
likeness to its center with 0.3 s of silence between, up to the length asked for (30 s by default, which
Irodori-TTS's README says captures most of the gain; at most 120 s). It goes to `references/<name>.wav` with a
manifest of its takes. `--candidates n` makes up to n references of the length instead, from all the takes rather
than the largest set, which can be too small for more than one: groups in which every pair holds and no sentence
is said twice, no take in two, the most alike first. `--takes sentence@seed,...` makes one from takes named by
hand. `tts --reference name` then has the model speak like it; the listening page shows how much each run sounds
like the reference it spoke like, or like the one chosen at the top of the page. `tts --duration-scale 0.5`
multiplies the length Irodori-TTS predicts for each sentence, which it otherwise leaves as predicted; the factor is
kept in the result file and tells runs apart on the listening page.

```sh
node src/cli.ts reference --name bright-young-woman-30s --seconds 30 ~/speech-bench-data/runs/tts-*-young-woman-words-*-speak-ja-JP-60/run.jsonl
node src/cli.ts tts --locale ja-JP --models irodori-tts-v4-small-16steps --reference bright-young-woman-30s --seeds 1
```

### Making a voice

A voice for a model without built-in voices is made from its recipe in `prompts/voices-<locale>.json`: an id, a
description in words, lines it would say in character, and, once chosen, the reference it speaks like with that
reference's sha256. `voice` takes a recipe through four steps, and every run it makes joins the campaign
`voice-<id>`:

```sh
node src/cli.ts voice gather soft-young-woman --locale ja-JP        # its lines with seeds 1 to 5, described in words
node src/cli.ts voice candidates soft-young-woman --locale ja-JP    # three references of 10 s from takes 0.8 alike
node src/cli.ts voice try soft-young-woman --locale ja-JP           # the measured sentences like each, in speech.cpp
node src/cli.ts web                                                 # Voices: hear and compare them, and choose one
```

`gather` has Irodori-TTS v4 Small in audio.cpp, the model that takes a description, say the lines; `candidates`
makes the references from those takes as `--candidates` does below, and never writes over candidates already
made, since runs name them; `try` has Irodori-TTS v4.1 Small MF in speech.cpp speak the sentences of
`prompts/speak-<locale>.json` like each candidate with seeds 1 and 2; `choose` copies the candidate to
`voice-<id>`, which it never replaces with other audio, and writes the choice into the recipe. `voice list`
shows the recipes and their choices, and `voice choose <id> <candidate>` chooses without the web app.

The web app's Voices page lists the recipes and how far each voice has been made, and sets the chosen voices side
by side on the sentences the most of them were tried with: their figures, the other voice each sounds most like,
and how alike every two of them are, so that two voices that would sound like one person stand out. A voice's page
shows the steps with their commands and a button that runs each with the command's defaults (one at a time, since
each holds the GPU; the Jobs page keeps their output and the header shows the one running), and the candidates as the model spoke like them, on the sentences and length
factor chosen at the top: each candidate summed up over every sentence of every seed (how alike its takes are, how
much they sound like its reference, what the recognizer heard and how many takes broke down), the one with the
smallest share of broken takes and then the most alike takes marked, the references and every take to play, and
a button that chooses one.


## Pinned inputs

Every download is pinned by URL and sha256; a Hugging Face file by repository, revision, size and sha256.

| Input | Version |
|---|---|
| llama.cpp | b11246 |
| CrispASR | v0.8.38 (its macOS build needs macOS 26) |
| Qwen3-ASR 1.7B and 0.6B | ggml-org Q8_0 |
| parakeet-tdt-0.6b-v3, parakeet-tdt_ctc-0.6b-ja, ReazonSpeech NeMo v2 | cstr Q8_0 |
| FLEURS | google/fleurs at revision 70bb2e84: ja-JP, en-US, fr-FR, de-DE, hi-IN, id-ID, it-IT, ko-KR, pt-BR and es-419 (it has no Spanish of Spain) |
| speech.cpp | v0.3.0, the worker and, to make voice files, the tools |
| Qwen3-TTS 0.6B and 1.7B CustomVoice | sakasegawa/qwen3-tts-ggml Q8_0 and the F16 codec, converted with BCP 47 language tags |
| Irodori-TTS v4.1 Small, MF and RF | sakasegawa/irodori-tts-ggml F16 and the F32 codec |
| audio.cpp | v0.8.2-audio8-perf-hotfix |
| Irodori-TTS v4 Small | audio-cpp/audio.cpp-gguf Q8_0 |
| sherpa-onnx | 1.13.8, the Node addon of its npm packages for macOS arm64 and Windows x64, for speaker embeddings and the VAD |
| 3D-Speaker ERes2NetV2 | csukuangfj/speaker-embedding-models, the speaker embedding model |
| Silero VAD v4 | csukuangfj/vad, which finds the voice of an utterance |

## Development

```sh
npm test
npm run typecheck
npm run web:build
```

`npm run web:dev` serves the app from its source on port 5173, reloading on each change, and passes `/api` and
`/audio` to `node src/cli.ts web`, which must be running on port 5280.

AGENTS.md holds the rules for changing the code.

## License

MIT. The models and datasets have licenses of their own, which `node src/cli.ts models` lists.
