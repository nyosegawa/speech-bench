# speech-bench

Measures the local speech models [ASIST](https://github.com/nyosegawa/asist) uses or may use, under the
conditions ASIST runs them in, for speech recognition and speech synthesis. It runs pinned ggml releases
(llama.cpp, CrispASR, the Qwen3-TTS worker ASIST ships, audio.cpp) on macOS with Metal and on Windows with
Vulkan, so that a model is chosen
for speech.cpp on numbers from the machines ASIST ships to, and a port can later be checked against them.

## Requirements

- macOS on Apple Silicon, or Windows x64 with a discrete GPU
- Node.js 22.18 or later (TypeScript runs directly through type stripping)

```sh
npm install
```

## Use

```sh
# The models, and the languages each one transcribes
node src/cli.ts models

# Three models on the first 100 utterances of the Japanese FLEURS test split
node src/cli.ts asr --locale ja-JP --models qwen3-asr-1.7b,parakeet-tdt_ctc-0.6b-ja,reazonspeech-nemo-v2 --count 100

# Speech synthesis: the Japanese sentences of prompts/speak-ja-JP.json, spoken and then transcribed
node src/cli.ts tts --locale ja-JP --models qwen3-tts-0.6b,qwen3-tts-1.7b,irodori-tts-v4-small-8steps

# Ten of those sentences from each of five seeds, to hear which seed gives a voice worth keeping
node src/cli.ts tts --locale ja-JP --models irodori-tts-v4-small-16steps --seeds 1,2,3,4,5 \
  --only aizuchi-hai,aizuchi-naruhodo,reply-weather,reply-meeting,reply-sorry,number-date,mixed-github,question-which,long-plan,long-cause

# Record your own utterances, then measure on them (see below)
node src/cli.ts record --locale ja-JP --speaker guest
node src/cli.ts asr --locale ja-JP --models qwen3-asr-1.7b --set recordings --speaker guest

# One table of every result so far
node src/cli.ts report

# The same ten sentences in each voice described in prompts/designs-ja-JP.json, all from seed 1
node src/cli.ts tts --locale ja-JP --models irodori-tts-v4-small-16steps --seeds 1 \
  --designs young-woman-words,young-woman-caption,young-woman-detailed --only aizuchi-hai,reply-weather,long-plan

# A page that plays the synthesized speech of one set of sentences; --blind hides and shuffles the names
node src/cli.ts listen --blind
node src/cli.ts listen --page irodori-voices ~/speech-bench-data/results/tts-*-woman-*-speak-ja-JP-10.jsonl
```

## Data

Downloads, recordings, logs and results live outside the repository, in `~/speech-bench-data`, or in the
folder `SPEECH_BENCH_DATA` names.

```text
~/speech-bench-data/
  models/      model files from Hugging Face, by repository and revision
  datasets/    FLEURS transcriptions and audio archives
  fleurs/      the FLEURS recordings unpacked for measuring
  runtimes/    llama.cpp, CrispASR, qwen3-tts-ggml and audio.cpp releases
  recordings/  your recordings, <locale>/<speaker>/manifest.jsonl
  references/  reference voices made from synthesized takes, <name>.wav and <name>.json
  asist-input/ what ASIST's VAD received in sessions with ASIST, <locale>/<speaker>/<session>/
  logs/        server output
  results/     one JSON Lines file per run, and for synthesis a folder of the speech beside it
```

Model files ASIST has already prepared (`~/Library/Application Support/ASIST/speech-models`, on Windows
`%APPDATA%\asist\speech-models`) are taken over after their sha256 is checked.

### Your own recordings

```sh
node src/cli.ts record --locale ja-JP --speaker guest
```

This serves a recording page on the loopback interface. It shows the prompts of `prompts/record-<locale>.json`
one by one (short answers, requests with names and technical words, numbers, mixed English, fillers and
long utterances, the kinds of speech ASIST hears), records the microphone without echo cancellation, noise
suppression or automatic gain, and saves 16 kHz WAVE files with the text that was said. The controls, the
progress and an input level meter stay at the top while a long prompt is read; each saved recording shows its
waveform, its loudest sample and the level of the room around the voice, and says when it is too quiet or
clipped. A prompt's text can
be edited before recording when it will be said differently, and free recordings can be added.
`--prompts` reads another prompts file.

Each speaker's recordings are kept apart under the name given with `--speaker`, and each speaker is measured
as a set of their own (`--set recordings --speaker guest`), so that a model that hears one voice well and
another badly shows it. The recordings are listed in `recordings/<locale>/<speaker>/manifest.jsonl`, one
object per line, with `audio` relative to the manifest:

```json
{"id": "short-hai", "audio": "short-hai.wav", "text": "はい"}
```

### What ASIST hears

Recordings made on the page above have no echo cancellation, noise suppression or automatic gain; ASIST
hears through all three. A session with ASIST listening records what ASIST's VAD itself receives:

```sh
node src/cli.ts asist-input --locale ja-JP --speaker sakasegawa --mic builtin --capture native
node src/cli.ts input-report
```

ASIST has to be running with `--remote-debugging-port=9222`; the session turns its microphone on. `--capture` restarts
ASIST's microphone on the native helper (`native`, macOS voice processing, with DeepFilterNet when ASIST's
noise suppression is on) or on `getusermedia` (Chromium's processing) for the session, and puts back what
the settings chose afterwards; `--mic` names the microphone the system uses as its input, for the report.
The terminal walks the speaker through `prompts/asist-input-<locale>.json`: silence, short answers,
requests, a long utterance and an interruption while ASIST replies, a softer voice, a voice from a metre
away, noises (a cough, typing, a knock on the desk) and talk that is not meant for ASIST. It moves on by
itself once ASIST has finished with an item, and ASIST answers as it does in use, so its replies and their
echo are part of the recording. When the session ends, ASIST's microphone is off.

A session folder holds the audio the VAD received (`input.wav`, 16 kHz float), every frame with the state
around it (`frames.jsonl`: the noise floor, the playback boost, Silero's voice probability, the hangover,
whether a capture was open and how it ended, whether the assistant was speaking), the stretch each item
covered (`items.jsonl`) and the conditions (`session.json`: the device, getUserMedia's applied settings,
ASIST's version). `input-report` gives, for each session, the level of the room and of the assistant's echo,
each item's loudest frame and the 95th percentile of its voice, what ASIST did with it, and what the VAD
would do on the same frames with the values given by `--min-threshold`, `--min-voiced-ms`,
`--min-utterance-ms` and `--min-speech-ms`.

## How the audio is prepared

By default each utterance is prepared the way ASIST prepares a capture: the recording is scaled to a peak
of 0.9, cut from 300 ms before ASIST's energy VAD would start the capture to the end of the hangover after
it would close it, and scaled to a peak of 0.9 again. `--hangover` sets the hangover (600 ms, ASIST's
default). An utterance of which ASIST's VAD keeps nothing, such as a short answer with less than 250 ms of
voice, is not sent: the result records it as dropped, and the report counts it in its own column and
leaves it out of the error rate and the timings. `--edges as-recorded` sends the recording as it is, with `--trailing-silence` seconds of silence
after it.

## What is measured

### Speech recognition

- **Error rate**: characters (CER) for Japanese, Korean and Chinese, words (WER) for the other languages,
  after NFKC and with punctuation and symbols removed; Japanese numbers are compared as Arabic digits, so
  that 一ドル and 1ドル are equal. The errors of the whole set are divided by the length of its references,
  rather than averaging the rates of single utterances. Errors are counted when a report is made, from the
  texts the result files keep, so that every result is scored by the same rules.
- **Time**: from sending the whole utterance to receiving its text, which is what the user waits for after
  ASIST's VAD closes the utterance. The first utterance is transcribed once more, untimed, because it pays
  for the GPU's first use.
- **Empty results**: utterances that came back without text.

### Speech synthesis

- **First audio**: from sending a sentence to receiving its first audio. The Qwen3-TTS worker streams
  audio while it generates; audio.cpp's Irodori-TTS answers with the whole sentence, so its first audio
  arrives with the last.
- **Real-time factor**: the synthesis time over the length of the speech.
- **Heard error rate**: the speech is transcribed by Qwen3-ASR 1.7B, after the synthesis model has
  stopped, and compared with the sentence as for recognition. It counts misreadings, dropped or repeated
  words, and speech that runs on past the sentence.
- **Seconds per character**: the pace of the speech, which shows a model that rushes or runs on.
- The speech of every sentence is saved as a WAVE file in the folder named after the result file, for
  listening.

A model without built-in voices (Irodori-TTS here) makes a voice up for every sentence from the seed it is
sampled with, which audio.cpp picks at random for each request. `--seeds` samples every sentence of a run from
one seed, with one run for each seed; only the models in audio.cpp take a seed. A seed does not keep the voice:
Irodori-TTS follows the sentence more than the seed. `--designs` describes the voice in words instead, with the
descriptions of `prompts/designs-<locale>.json` (Irodori-TTS's `instruction`), one run for each.

On a Mac, Irodori-TTS's codec runs on the CPU. audio.cpp's Metal codec (v0.8.2) adds a distorted copy of the
voice, heard as a doubled voice with a low hum, which its CPU and Vulkan codecs do not; the CPU codec takes 4 to
7 times as long, which the Mac's times to the first audio include. The options a runtime was loaded with are
recorded with each result and shown in the report. A model with built-in voices
speaks with the voice native to the locale, or the one `--voice` names.

The listening page shows each run as a voice: its sentences play in a row, to hear whether it stays the same
voice, and each sentence plays in every voice in turn, to compare them. Voices can be starred while listening.
Without `--blind` the page opens with a summary: a table of the voices, sortable and marked green or red, and a
chart with a point for each sentence of each voice, which plays it. For each voice it gives:

- **Same voice**: how alike the sentences sound, the mean cosine similarity of the speaker embeddings
  (3D-Speaker ERes2NetV2) of every pair of sentences with 1.5 s of voice or more. One real speaker's recordings
  are 0.84 alike and 0.33 like other men's, Qwen3-TTS's ono_anna 0.76, and Irodori-TTS without a description 0.47 to 0.57.
  Each sentence also shows how much it sounds like the rest, which singles out one spoken in another voice.
- **Pitch spread**: the standard deviation of the sentences' median pitch in semitones; ono_anna 1.5 to 1.8,
  Irodori-TTS without a description 3.6 to 6.6.
- What the recognizer heard, the sentences that broke down (more than 30% of their characters heard wrong),
  and the time to the first audio.

`neighbors` writes a page for the takes meant to be one voice (one model with one voice or description, loaded
the same way on the same GPU, whatever the seed or sentence): a table of how alike every pair is, ordered so that
one voice shows as a block, each take's nearest and farthest takes, and the largest set of takes at least a chosen
similarity to one center, one take per sentence, to be heard in a row. One voice rates a sentence it says twice
about 0.07 more alike than two different sentences (Qwen3-TTS's ono_anna, 0.82 against 0.74), so a set of one
sentence said with many seeds would hold together for the wrong reason.

```sh
node src/cli.ts neighbors --page irodori ~/speech-bench-data/results/tts-*-irodori-*.jsonl
```

`reference` makes a reference voice out of such takes: the largest set in which every pair is at least the
threshold alike (0.8 by default, which sounds like one voice by ear), one take per sentence, joined in order of
likeness to its center with 0.3 s of silence between, up to the length asked for (30 s by default, which
Irodori-TTS's README says captures most of the gain; at most 120 s). It goes to `references/<name>.wav` with a
manifest of its takes. `--candidates n` makes up to n references of the length instead, from all the takes rather
than the largest set, which can be too small for more than one: groups in which every pair holds and no sentence
is said twice, no take in two, the most alike first. `--takes sentence@seed,...` makes one from takes named by
hand. `tts --reference name` then has
the model speak like it; the listening page shows how much each run sounds like the reference it spoke like, or
like the one `listen --reference name` names.

```sh
node src/cli.ts reference --name bright-young-woman-30s --seconds 30 ~/speech-bench-data/results/tts-*-young-woman-words-*-speak-ja-JP-60.jsonl
node src/cli.ts tts --locale ja-JP --models irodori-tts-v4-small-16steps --reference bright-young-woman-30s --seeds 1
```

## Pinned inputs

Every download is pinned by URL and sha256; a Hugging Face file by repository, revision, size and sha256.

| Input | Version |
|---|---|
| llama.cpp | b11246, the release ASIST ships |
| CrispASR | v0.8.38 (its macOS build needs macOS 26) |
| Qwen3-ASR 1.7B and 0.6B | ggml-org Q8_0, the files ASIST pins |
| parakeet-tdt-0.6b-v3, parakeet-tdt_ctc-0.6b-ja, ReazonSpeech NeMo v2 | cstr Q8_0 |
| FLEURS | google/fleurs at revision 70bb2e84: ja-JP, en-US, fr-FR, de-DE, hi-IN, id-ID, it-IT, ko-KR, pt-BR and es-419 (it has no Spanish of Spain) |
| qwen3-tts-ggml | v0.1.1, the worker ASIST ships |
| Qwen3-TTS 0.6B and 1.7B CustomVoice | sakasegawa/qwen3-tts-ggml Q8_0 and the F16 codec, the files ASIST pins |
| audio.cpp | v0.8.2-audio8-perf-hotfix |
| Irodori-TTS v4 Small | audio-cpp/audio.cpp-gguf Q8_0 |
| sherpa-onnx | 1.13.8, the Node addon of its npm packages for macOS arm64 and Windows x64, for speaker embeddings |
| 3D-Speaker ERes2NetV2 | csukuangfj/speaker-embedding-models, the speaker embedding model |

## Development

```sh
npm test
npm run typecheck
```

AGENTS.md holds the rules for changing the code.

## License

MIT. The models and datasets have licenses of their own, which `node src/cli.ts models` lists.
