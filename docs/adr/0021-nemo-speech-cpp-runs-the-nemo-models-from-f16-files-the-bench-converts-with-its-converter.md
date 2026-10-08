# NeMo-Speech.cpp runs the NeMo models from F16 files the bench converts with its converter

NVIDIA's NeMo-Speech.cpp runs NeMo's FastConformer models on ggml, as speech.cpp does, and is measured beside it on
the models the two share: parakeet-tdt-0.6b-v3 and ReazonSpeech NeMo v2. The bench runs the pinned release's
`nemo-speech serve` with the model file it made itself and asks its OpenAI transcription endpoint for each utterance
whole, as it asks CrispASR, timed from sending the request to reading the answer.

- **F16 files converted by the bench.** speech.cpp's FastConformer files are F16. For NeMo-Speech.cpp, NVIDIA
  publishes parakeet-tdt-0.6b-v3 in Q8_0 alone (nvidia/parakeet-tdt-0.6b-v3 at 541d1f99, the file its CLI's catalog
  pins) and ReazonSpeech not at all. The bench converts both checkpoints, the revisions speech.cpp's files were
  converted from, with NeMo-Speech.cpp's `convert_model.py --outtype fp16` at the commit of v0.2.0, the release it
  runs: Git fetches the converter by its commit, uv installs the packages `converters/nemo-speech.cpp/uv.lock` pins,
  and the file is kept only when its size and sha256 are the ones the catalog pins for the platform that converted it
  (`darwin-arm64`, `win32-x64`), in a folder named by that sha256, so that a file made elsewhere is never taken for
  it. A result records the sha256 of the file it measured.
  NeMo-Speech.cpp's own guide names F16 for Apple silicon and older GPUs, which the M5 and the RTX 2080 are.
- **Batching off.** `nemo-speech serve` batches the work of concurrent requests by default and waits up to 5 ms at
  each neural stage for more; the bench sends one request at a time and turns it off (`asr.batching.enabled=false`),
  as NeMo-Speech.cpp leaves it for a single caller of its library. The result records the setting.
- **The model's own text.** A request sets `automatic_punctuation`, without which the server lowercases the text and
  drops the punctuation the model writes, and `verbatim`, which keeps inverse text normalization out. The server is
  started without any `NEMO_SPEECH_` variable of the bench's environment, from which it would read engine settings
  such as a punctuation model or masking silence with a VAD.
- **No warm-up of its own** (`--no-warmup`), so that the load time is the loading alone, as for speech.cpp's worker.
- **The device named.** The bench's GPU is passed as `metal` or `vulkan:N`; a device that does not start stops the
  server rather than leaving the model on the CPU.

NeMo-Speech.cpp decodes an RNN-T model greedily alone, so its ReazonSpeech compares with speech.cpp's greedy decoding
(docs/adr/0020). Its converter does not read the checkpoint's Longformer global token (`global_tokens: 1`): its encoder
attends to the 128 frames on either side of each frame without it, where speech.cpp's attends as NeMo does.

## Rejected

- **NVIDIA's Q8_0 file of parakeet-tdt-0.6b-v3.** The comparison would weigh the weight type with the runtime, and
  ReazonSpeech would still need converting.
- **The converter's requirements.txt.** It names torch without a version and every family's packages; a conversion
  with other versions could write other bytes, and no one could make the pinned file again.
- **Letting `nemo-speech` download its indexed models.** They go into its own cache, and only the Q8_0 file is indexed.
- **`nemo-speech transcribe` for each utterance.** It loads the model for every call, which a server keeps loaded.

## Measured

2026-10-08, Apple M5, NeMo-Speech.cpp v0.2.0:

- Two conversions of ReazonSpeech under different file names differed in `general.name` alone, which the converter
  takes from the output's file name when the checkpoint names no model; the bench converts under the name it keeps.
- ReazonSpeech's file converted and ran. On the three longest Japanese FLEURS utterances (26.6 to 28.2 s), its text
  was speech.cpp's greedy text to the character; on the first 5 clips of Common Voice 8.0 Japanese, trimmed to the
  voice, one clip came back with 松居 where speech.cpp wrote 松井.
- parakeet-tdt-0.6b-v3 on the first 5 utterances of English FLEURS gave the same WER, 5.26%, as speech.cpp v0.7.1.

- The same checkpoints converted on an Intel Windows machine with uv 0.4.24 made files of the same sizes and other
  bytes: parakeet-tdt-0.6b-v3 `c44ce57a…` against the M5's `6e55f55e…`, ReazonSpeech `32b12198…` against `4b5806fd…`.
  The converter computes the positional encoding with torch and the mel filterbank with librosa, which round a last
  bit otherwise on another processor. So each platform has its own pin.

## Known limits

- A platform without a pin stops the run after converting, naming the sha256 it made, which is pinned once checked.
