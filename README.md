# speech-bench

Measures local speech recognition and speech synthesis models under one set of conditions, across the runtimes
they run in and the machines they run on, so that [speech.cpp](https://github.com/nyosegawa/speech.cpp) takes up
a model on numbers, and a port can be checked against the model it was ported from. It runs pinned releases
(llama.cpp, CrispASR, speech.cpp, NeMo-Speech.cpp, audio.cpp) on macOS with Metal and on Windows with Vulkan. It
also makes voices for models that have none built in, from a description and lines in character.

## Requirements

- macOS on Apple Silicon, or Windows x64 with a discrete GPU
- Node.js 22.18 or later (TypeScript runs directly through type stripping)
- [uv](https://docs.astral.sh/uv/), only for the implementations the adapters run (Irodori-TTS's official one and mlx-audio)
  and for NeMo-Speech.cpp's converter, and Git, which fetches the converter
- [GitHub CLI](https://cli.github.com/), logged in, only to measure a build of speech.cpp's CI

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

# The same in mlx-audio's port, on a Mac through MLX
node src/cli.ts tts --locale ja-JP --models irodori-tts-v4.1-small-mf-mlx --reference voice-bright-young-woman --seeds 1

# Ten of those sentences from each of five seeds, to hear which seed gives a voice worth keeping
node src/cli.ts tts --locale ja-JP --models irodori-tts-v4-small-q8_0-16steps --seeds 1,2,3,4,5 \
  --only aizuchi-hai,aizuchi-naruhodo,reply-weather,reply-meeting,reply-sorry,number-date,mixed-github,question-which,long-plan,long-cause

# The test split of Common Voice 8.0 Japanese, which Japanese models report their rates on (4,483 clips)
node src/cli.ts asr --locale ja-JP --models qwen3-asr-1.7b --set common-voice --count 4483

# Qwen3-ASR in llama.cpp and in speech.cpp, on the same clips
node src/cli.ts asr --locale ja-JP --models qwen3-asr-1.7b,qwen3-asr-1.7b-speech.cpp --set common-voice --count 100

# The same in a local build of speech.cpp, a release candidate, in place of the pinned release
SPEECH_BENCH_SPEECH_CPP=~/src/speech.cpp/build node src/cli.ts asr --locale ja-JP --models qwen3-asr-1.7b-speech.cpp --set common-voice --count 100

# ReazonSpeech NeMo v2 with its beam search and with greedy decoding, which only speech.cpp's main branch offers
SPEECH_BENCH_SPEECH_CPP=~/src/speech.cpp/build node src/cli.ts asr --locale ja-JP \
  --models reazonspeech-nemo-v2-speech.cpp,reazonspeech-nemo-v2-greedy-speech.cpp --set common-voice --count 4483

# parakeet-tdt-0.6b-v3 in speech.cpp and in NVIDIA's NeMo-Speech.cpp, from F16 files of the same checkpoint
node src/cli.ts asr --locale fr-FR --models parakeet-tdt-0.6b-v3-speech.cpp,parakeet-tdt-0.6b-v3-nemo-speech.cpp --count 100

# Measure on your own utterances, recorded under Record in the web app (see below)
node src/cli.ts asr --locale ja-JP --models qwen3-asr-1.7b --set recordings --speaker guest

# One table of every result so far
node src/cli.ts report

# The same ten sentences in each voice described in prompts/voices-ja-JP.json, all from seed 1
node src/cli.ts tts --locale ja-JP --models irodori-tts-v4-small-q8_0-16steps --seeds 1 \
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
  converted/   model files converted from checkpoints, by converter and commit
  converters/  the converters at their commits and their Python environments
  datasets/    FLEURS transcriptions and audio archives, and the copy of Common Voice 8.0
  fleurs/      the FLEURS recordings unpacked for measuring
  common-voice/ the Common Voice clips decoded to 16 kHz WAVE for measuring
  spellings/   the work directories of annotating accepted spellings
  huggingface/ the annotations of Common Voice as they are uploaded to Hugging Face
  runtimes/    llama.cpp, CrispASR, speech.cpp, NeMo-Speech.cpp and audio.cpp releases, and speech.cpp's CI builds by run
  recordings/  your recordings, <locale>/<speaker>/manifest.jsonl
  references/  reference voices made from synthesized takes, <name>.wav and <name>.json
  voice-files/ Irodori-TTS voice files made from the references for speech.cpp, by reference, codec and release or build
  adapters/    the Python environments of the adapters
  logs/        server output
  runs/        a folder per run: run.jsonl, the speech of each sentence and analysis.json
  campaigns/   the runs of each experiment, <name>.json
```

`run.jsonl` holds what was measured, one JSON line for the run and one per utterance or sentence. It, the
campaigns, the manifests of the reference voices and of your recordings carry the version of their form, and the
bench reads an earlier version as the current one; a version it does not know is refused with the file named.
`analysis.json` holds what is read from the speech (its voice, pitch and speaker embedding). A synthesis run makes it
as it ends, so that a page does not read the speech again, and it is made again when the speaker model or the way
it is computed changes, or when it no longer matches the run's sentences.
`node src/cli.ts analyze` makes it for the runs made before, which a page would otherwise analyze while it loads
(640 takes took 225 s on an Apple M5). `--campaign name` on `asr` or `tts` adds the run to an experiment, which
`report` and `analyze` then take with `--campaign name` and the web app's runs page filters by.

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
another badly shows it. The recordings are listed in `recordings/<locale>/<speaker>/manifest.jsonl`: a first
line with the version of its form, then one object per recording, with `audio` relative to the manifest.

```json
{"format": 1}
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
  compared as written after folding only what never changes the word: NFKC, case, traditional kanji forms into
  the forms in use, spaces and the punctuation that is not read. Marks that are read stay (27% and 27 differ),
  and 一ドル against 1ドル or あー against ああ count as written (docs/adr/0015). The errors of the whole set are divided by the length of its references,
  rather than averaging the rates of single utterances. Errors are counted when a report is made, from the
  texts the result files keep, so that every result is scored by the same rules.
- **Error rate with accepted spellings**: for Japanese, the errors left when a transcription may write any part
  of the reference in the kana of its reading, hiragana or katakana, and a stretch as one of the other spellings
  the sentence is annotated with (三時 as 3時, 打ち合わせ as 打合せ). Another kanji with the same sound stays an
  error. The annotations are in `spellings/<source>-<locale>.jsonl`, one sentence per line, readings written
  `明日《あした》` and other spellings `［九《く》時《じ》／9時］` (docs/adr/0013). A run gets the rate once every
  utterance it heard is annotated; until then the report says how many are.
- **Time**: from sending the whole utterance to receiving its text, which is what a speaker waits for once
  an application's VAD has closed the utterance. The first utterance is transcribed once more, untimed, because it pays
  for the GPU's first use.
- **Empty results**: utterances that came back without text.

Qwen3-ASR runs in llama.cpp's llama-server from ggml-org's files, the NeMo models in CrispASR, and all five in
speech.cpp from the files speech.cpp converts from their checkpoints, Qwen3-ASR in Q8_0 and the NeMo models in F16;
the ids of the speech.cpp entries end in `-speech.cpp`. speech.cpp's Qwen3-ASR writes the official implementation's
prompt, with its system turn, where llama.cpp's has none and other audio tokens, so that a run of each on one set
shows what that changes. Both are told the language the same way, as the start of the answer. The NeMo models in
speech.cpp only check the language they are sent, and parakeet-tdt-0.6b-v3 finds it itself there as in CrispASR.
speech.cpp's worker is reached through its worker protocol 2 (docs/adr/0008): an utterance goes as chunks of the
16-bit samples the servers are sent as a WAVE file, then a request for its text, and the wait runs from the first
chunk to the text. ReazonSpeech NeMo v2 decodes with its checkpoint's beam search, and
`reazonspeech-nemo-v2-greedy-speech.cpp` asks every request for greedy decoding, which speech.cpp's main branch
offers and v0.7.1 does not (docs/adr/0020); a worker whose model does not offer it stops the run before it measures.

parakeet-tdt-0.6b-v3 and ReazonSpeech NeMo v2 also run in NVIDIA's NeMo-Speech.cpp, its `nemo-speech serve` asked
as CrispASR is, with the utterance whole, batching off and the model's own text (docs/adr/0021). NVIDIA publishes
parakeet-tdt-0.6b-v3 for it in Q8_0 alone and ReazonSpeech not at all, so the bench converts both checkpoints to F16,
the weight type of speech.cpp's files, with NeMo-Speech.cpp's converter at the commit of the release it runs: it
fetches the converter with Git, installs the packages `converters/nemo-speech.cpp/` locks through uv, and keeps the
file only when its size and sha256 are the ones pinned. NeMo-Speech.cpp decodes an RNN-T model greedily, so its
ReazonSpeech compares with `reazonspeech-nemo-v2-greedy-speech.cpp`.

Recognition runs of one set, chosen on the web app's runs page, open the transcripts page: what every run heard of
each utterance, as it was scored, with what it heard for another unit, heard but was not said, and did not hear
marked against the reference, its errors beside it. It shows the utterances some run heard wrong, or those the runs
heard differently, in the set's order or the most errors first. Where the sentences are annotated, it lines each
transcription up with their readings and accepted spellings and marks what passed as one, with the stretch as
written in its title; a switch shows the alignment as written. The runs page and the transcripts page give the
error rate with accepted spellings beside the plain one.

The Spellings page shows the annotations of each source: every sentence with its readings above the parts they
read, the other spellings after each bracketed stretch, its note, and the agent, skill and day that made it.

### Annotating accepted spellings

The annotations behind the error rate with accepted spellings are made by Codex with the skill in
`skills/accepted-spellings/`, from the reference sentences alone (docs/adr/0014). It needs the Codex CLI, 0.160
or later for gpt-6.1-sol.

```sh
# Annotate the sentences of a source no annotation file holds yet, in work directories of up to 1,000
node src/cli.ts spellings annotate --source fleurs-ja-JP --sessions 4

# Merge a work directory whose session stopped, once its draft is whole
node src/cli.ts spellings merge ~/speech-bench-data/spellings/fleurs-ja-JP/<work directory>
```

The sources are `fleurs-<locale>`, the test split of FLEURS, `common-voice-8-<locale>`, the test split of Common
Voice 8.0, and `record-<locale>`, the prompts of the Record page. Each work directory, under `spellings/<source>/` of the data folder, holds the sentences, the agent's
draft and its log; a draft is merged into `spellings/<source>.jsonl` only when every sentence has a line that
reads, with the agent, its model, the commit of the skill and the day. The skill must be committed first.

The annotations of the test split of Common Voice 8.0 Japanese are published on Hugging Face as
[sakasegawa/common-voice-ja-accepted-spellings](https://huggingface.co/datasets/sakasegawa/common-voice-ja-accepted-spellings),
CC0 like Common Voice: a row for each clip with its sentence and annotation, and `score.py`, which counts in
Python as the bench does (docs/adr/0017). The card and the scorer are kept in
`huggingface/common-voice-ja-accepted-spellings/`; `spellings export` writes them with the rows into the data folder,
ready to upload:

```sh
node src/cli.ts spellings export
hf upload sakasegawa/common-voice-ja-accepted-spellings ~/speech-bench-data/huggingface/common-voice-ja-accepted-spellings . --repo-type dataset
```

### Speech synthesis

- **First audio**: from sending a sentence to receiving its first audio. speech.cpp's Qwen3-TTS streams audio
  frame by frame while it generates, and its Irodori-TTS makes a sentence at once and streams it as the codec
  decodes it; audio.cpp's Irodori-TTS answers with the whole sentence, so its first audio arrives with the
  last.
- **Real-time factor**: the synthesis time over the length of the speech.
- **Heard error rate**: the speech is transcribed by Qwen3-ASR 1.7B, after the synthesis model has
  stopped, and compared with the sentence after NFKC and without punctuation, symbols and spaces, Japanese
  numbers read as Arabic digits and a long vowel mark as the vowel it lengthens (docs/adr/0002, 0006). A
  sentence counts at most all of its characters as errors, so that one take that runs on cannot decide the
  rate of a voice. It counts
  misreadings, dropped or repeated words, and speech that runs on past the sentence.
- **Heard as said**: the sentences the recognizer heard as they were written, apart from how it spells them
  (in Japanese katakana or hiragana, small or full-size vowels, あー or ああ), but not shorter, longer or with a
  word more. A take that passes is one an application could keep, as when it makes short replies ahead of
  time and keeps the takes heard right.
- **Seconds per character**: the pace of the speech, which shows a model that rushes or runs on.
- The speech of every sentence is saved as a WAVE file in the run's folder, for listening.

A model without built-in voices (Irodori-TTS here) makes a voice up for every sentence from the seed it is
sampled with, which audio.cpp picks at random for each request. `--seeds` gives one run for each seed: audio.cpp
samples every sentence of a run from it, and speech.cpp and the adapters the first request, each later one from
the next seed. A seed does not keep the voice:
Irodori-TTS follows the sentence more than the seed. `--designs` describes the voice in words instead, with the
descriptions of the voices in `prompts/voices-<locale>.json` (Irodori-TTS's `instruction`), one run for each.

Runtimes run as a process, speech.cpp's worker among them, are reached through speech.cpp's worker protocol 2
(docs/adr/0008): JSON lines, a request per line, the speech streamed back in base64 16-bit chunks. A worker of
another protocol, or one that answers a request it was not sent or answers one twice, stops the run. Irodori-TTS
v4.1 in speech.cpp has no voice of its own and needs `--reference`; the reference goes to the worker as a voice
file, which `speech voice` makes once on the CPU and `voice-files/` keeps by the reference, the codec the model
file names and the release of speech.cpp, so that a release that refuses the voice files of the ones before it,
as v0.7.0 does, makes its own from the reference.

A model's official implementation runs in an adapter of the bench's own that speaks the same protocol
(docs/adr/0012): `adapters/irodori-tts/` runs Irodori-TTS v4.1's official PyTorch runtime at FP32 on the Mac's
GPU, from the revisions of the checkpoints speech.cpp's GGUFs were converted from. The adapter encodes the
reference voice's WAVE file once, as the runtime would, and gives every sentence the latent, as speech.cpp's
worker is given a voice file. uv installs the packages the adapter's lock file pins into `adapters/` of the data folder on the
first run, before the timing starts. The official runtime does not stream, so its first audio arrives with the
last.

`adapters/mlx-audio/` runs mlx-audio's port of Irodori-TTS v4.1 on the Mac's GPU through MLX, from
mlx-community's FP16 conversions. `generate()` encodes the reference for every sentence, so the adapter keeps
the latent of the voice it loaded and hands it back; mlx-audio does not stream Irodori-TTS either. Called in one
process, without the worker protocol, mlx-audio's MF took 1.41 s at the median over the 20 sentences, against
the 1.44 s the bench measured (Apple M5, 2026-10-05).

On a Mac, audio.cpp's Irodori-TTS v4 Small runs its codec on the CPU. audio.cpp's Metal codec (v0.8.2 and v0.9.0) adds a distorted copy of the
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
node src/cli.ts tts --locale ja-JP --models irodori-tts-v4-small-q8_0-16steps --reference bright-young-woman-30s --seeds 1
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
| Qwen3-ASR 1.7B and 0.6B in llama.cpp | ggml-org Q8_0, each with its audio projector |
| parakeet-tdt-0.6b-v3, parakeet-tdt_ctc-0.6b-ja, ReazonSpeech NeMo v2 in CrispASR | cstr Q8_0 |
| FLEURS | google/fleurs at revision 70bb2e84: ja-JP, en-US, fr-FR, de-DE, hi-IN, id-ID, it-IT, ko-KR, pt-BR and es-419 (it has no Spanish of Spain) |
| speech.cpp | v0.7.1, its one executable `speech`, whose worker runs the synthesis and recognition models and whose `speech voice` makes voice files |
| Qwen3-ASR 1.7B and 0.6B in speech.cpp | sakasegawa/Qwen3-ASR-1.7B-GGUF and sakasegawa/Qwen3-ASR-0.6B-GGUF, one Q8_0 file each with the audio encoder inside, the layout speech.cpp v0.7.0 reads |
| parakeet-tdt-0.6b-v3, parakeet-tdt_ctc-0.6b-ja, ReazonSpeech NeMo v2 in speech.cpp | sakasegawa/parakeet-tdt-0.6b-v3-GGUF, sakasegawa/parakeet-tdt_ctc-0.6b-ja-GGUF and sakasegawa/reazonspeech-nemo-v2-GGUF, one F16 file each, the layout speech.cpp v0.7.0 reads |
| Qwen3-TTS 0.6B and 1.7B CustomVoice | sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF and sakasegawa/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF, one Q8_0 file each with the F16 codec inside, the layout speech.cpp v0.7.0 reads |
| Irodori-TTS v4.1 Small, MF and RF | sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF and sakasegawa/Irodori-TTS-v4.1-Small-GGUF, one F16 file each with the F32 codec inside, the layout speech.cpp v0.7.0 reads |
| NeMo-Speech.cpp | v0.2.0, `nemo-speech serve` |
| parakeet-tdt-0.6b-v3 and ReazonSpeech NeMo v2 in NeMo-Speech.cpp | nvidia/parakeet-tdt-0.6b-v3 and reazon-research/reazonspeech-nemo-v2, the `.nemo` checkpoints speech.cpp's files were converted from, converted to F16 by NeMo-Speech.cpp's `convert_model.py` at v0.2.0 (6a3ca369) with the packages of `converters/nemo-speech.cpp/uv.lock`, and pinned by the size and sha256 of the result |
| audio.cpp | v0.9.0 |
| Irodori-TTS v4 Small | audio-cpp/audio.cpp-gguf Q8_0 |
| sherpa-onnx | 1.13.8, the Node addon of its npm packages for macOS arm64 and Windows x64, for speaker embeddings and the VAD; on Windows its ONNX Runtime is renamed so that Windows ML's copy in System32 is not loaded in its place (docs/adr/0018) |
| Common Voice 8.0 | japanese-asr/ja_asr.common_voice_8_0 at revision bf8819e8: the test split of ja-JP, one Parquet file of MP3 clips and sentences, copied from Mozilla's release (CC0) |
| hyparquet | 1.31.2, its npm package, which reads the Parquet file |
| mpg123-decoder | 1.0.3 with the packages it imports, mpg123 in WebAssembly, which decodes the MP3 to the same samples on every machine |
| 3D-Speaker ERes2NetV2 | csukuangfj/speaker-embedding-models, the speaker embedding model |
| Silero VAD v4 | csukuangfj/vad, which finds the voice of an utterance |

### A build of speech.cpp before its release

`SPEECH_BENCH_SPEECH_CPP` names a build of speech.cpp whose `speech` every run then starts in place of the pinned
release's, to measure a release candidate before it is released: a local build, or a build of speech.cpp's CI.

A local build is named by its CMake build directory (`cmake -B build`, then `cmake --build build --config Release`)
(docs/adr/0019). The bench refuses a directory that is not a Release build of speech.cpp, and a source with changes
that are not committed. A result records the release number the build reports and the commit it was built from, and
the report writes its runtime as `speech.cpp 0.7.1, local build 596b8d83f166`, so that it is not taken for the
release's. Build it just before measuring: the bench cannot tell an executable built before the last `git pull`.

A build of speech.cpp's CI is named as `ci:<run id>`, a run of its workflow `build` (docs/adr/0022), which packs on
every run the archive a release publishes. This is how a candidate is measured on a machine with no build environment,
such as Windows: only [GitHub CLI](https://cli.github.com/), logged in with `gh auth login`, is needed, since GitHub
serves artifacts only to a signed-in user. On Windows, in PowerShell:

```powershell
# The runs of the workflow, newest first; take one of a push, or start one on a branch
gh run list -R nyosegawa/speech.cpp --workflow build
gh workflow run build -R nyosegawa/speech.cpp --ref <branch>

$env:SPEECH_BENCH_SPEECH_CPP = 'ci:37705728430'
node src/cli.ts asr --locale ja-JP --models qwen3-asr-1.7b-speech.cpp --set common-voice --count 100

# Back to the pinned release
Remove-Item Env:SPEECH_BENCH_SPEECH_CPP
```

The bench asks GitHub for the run each time, and takes it only when it ran for a push or was started by hand, and its
job that packs the system's archive (`windows-vulkan`, or `macos-metal` on a Mac) passed. A run of a pull request
builds the merge of the branch into its base rather than the branch's head, so it is refused. The first use downloads
the artifact, checks its sha256 against the one GitHub gives, unpacks `speech-<version>-windows-x64-vulkan.zip` from it
into `runtimes/speech.cpp-ci-<run id>` and checks that `speech --version` reports that version. A result records the
version, the run's commit and the run, and the report writes its runtime as `speech.cpp 0.7.1, CI build f5ab84c1710d`.

### A model file before it is published

`--model-file` runs a model file on this machine in place of the one pinned file of the model `--models` names, so
that a file speech.cpp makes for its next release, such as a weight type it quantizes or a file of a new layout, is
measured before it is on Hugging Face and compared with the published one (docs/adr/0023). `--model-sha256` names the
file by its sha256, which the bench checks before every run that uses it. The rest of the model stays as it is: its
runtime, its decoding or steps and its languages. A result records the file's name, size and sha256 as a local file,
and the run is kept under an id and label of its own that carry the start of the sha256, such as
`local Qwen3-ASR-1.7B-Q6_K.gguf (sha256 3c5d2a8e41f0) as qwen3-asr-1.7b-speech.cpp`, so that it is never taken for a
run of the published file, nor for one of a file made again under the same name.

```sh
# The Q6_K file of Qwen3-ASR 1.7B that speech.cpp made, in a local build of speech.cpp, beside the published Q8_0
file=~/src/github.com/nyosegawa/speech.cpp/models/quantized/Qwen3-ASR-1.7B-Q6_K.gguf
SPEECH_BENCH_SPEECH_CPP=~/src/github.com/nyosegawa/speech.cpp/build node src/cli.ts asr --locale ja-JP \
  --models qwen3-asr-1.7b-speech.cpp --model-file "$file" --model-sha256 "$(shasum -a 256 "$file" | cut -d ' ' -f 1)" \
  --set common-voice --count 4483

# Irodori-TTS v4.1 Small MF in layout 2
file=~/src/github.com/nyosegawa/speech.cpp/models/layout-2/Irodori-TTS-866M-MF-v4.1-F16.gguf
SPEECH_BENCH_SPEECH_CPP=~/src/github.com/nyosegawa/speech.cpp/build node src/cli.ts tts --locale ja-JP \
  --models irodori-tts-v4.1-small-mf --model-file "$file" --model-sha256 "$(shasum -a 256 "$file" | cut -d ' ' -f 1)" \
  --reference voice-bright-young-woman --seeds 1
```

On Windows, `(Get-FileHash <file>).Hash` gives the sha256.

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
