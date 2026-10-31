# A recognition model without a port runs in the code its card gives

The Japanese recognition models speech.cpp does not run, and two it runs whose official code the bench had not, are
measured in their official implementations through four adapters, each from its checkpoint pinned as the repository
publishes it (`src/catalog/official-asr.ts`). Every model runs the code of its card, in the dtype the card loads it in
on CUDA, with PyTorch's own attention where a card asks for FlashAttention 2 (docs/adr/0012), decoding as the card
decodes, which is greedy for all of them but ReazonSpeech NeMo v2, whose file sets ALSD beam search of width 4. A model
that can be told the language is told it, as every other runtime of the bench is.

- **transformers** (`adapters/transformers-asr/`) runs Whisper large-v3, Kotoba-Whisper v2.2, Moonshine Tiny Japanese,
  Granite Speech 5.0, Cohere Transcribe and Voxtral Realtime, each with the code of its card that the catalog's
  recipe names. The same worker runs ReazonSpeech's six CTC models (wav2vec 2.0, HuBERT and Zipformer) in an environment
  of transformers 4.57 of its own (`adapters/transformers-4-asr/`): the Zipformer's checkpoint carries its modeling code,
  saved with transformers 4.57.0, which transformers 5 refuses for lacking `all_tied_weights_keys`, and the six are
  compared with one another in one release.
- **NeMo** (`adapters/nemo-asr/`) runs ReazonSpeech NeMo v2 through ReazonSpeech's package, its `transcribe()` with
  the 0.5 s of silence it pads on each side, and parakeet-tdt_ctc-0.6b-ja as its card does, with its TDT decoder.
  Each file is given to NeMo's `restore_from()`, which is what `from_pretrained()` runs on the file it downloads.
- **ReazonSpeech k2** (`adapters/reazonspeech-k2/`) runs reazonspeech-k2-v2 through ReazonSpeech's package, with the
  recognizer its `load_model()` makes by default: the FP32 files, greedy search, one thread and the CPU, which is the
  device it takes unless told another and the one PyPI's sherpa-onnx runs on.
- **VibeVoice** (`adapters/vibevoice-asr/`) runs VibeVoice-ASR-Streaming 7B as its file demo runs a file, the whole
  utterance through `streaming_generate()` at the chunk and lookahead of the checkpoint, its text without the speaker
  labels and tags the model writes.

What a card's code does around the model that changes no word of a single utterance is left out. Kotoba-Whisper v2.2's
pipeline adds speaker diarization, which needs pyannote's gated models and finds one speaker in an utterance, and
punctuation, which the scoring folds (docs/adr/0015); the model runs as Whisper with its pipeline's language and task.

Granite Speech 5.0's card gives two instructions for transcription, one that names the language and one that asks for
punctuation and capitalization; the model is told the first, "The speech is in Japanese. Transcribe it exactly; do not
translate. can you transcribe the speech into a written format?", as the other models are told the language.

The two models made for streaming are given each utterance whole. Voxtral Realtime transcribes at the delay its
tekken.json sets, 480 ms, the one its card recommends, and VibeVoice at its checkpoint's chunk; how soon a word comes
while the speaker talks is not measured here, as the bench measures no runtime's live delay.

VibeVoice's acoustic tokenizer adds Gaussian noise to its latents as in training, and PyTorch seeds its generators anew
in each process, so the adapter seeds them with the catalog's seed, 0, before each utterance, which the run records: an
utterance then has the same text in every run, whatever the order of the set.

## Rejected

- **VibeVoice unseeded, as its demo runs.** One Japanese utterance of Common Voice came back as four different texts in
  four runs on an Apple M5 (2026-10-30), so that two runs of one set would not agree.
- **VibeVoice from the mean of its latents**, which its vLLM plugin offers (`VIBEVOICE_USE_MEAN`). It computes
  otherwise than the model was trained and is released to run.
- **The Zipformer's code changed to load in transformers 5**, or the six CTC models in two releases.
- **Voxtral Realtime in vLLM**, which its card recommends. vLLM serves the model over HTTP and WebSockets and runs on
  Linux alone; the card's transformers code runs the same checkpoint in the process the bench watches, on every
  system the bench measures on.
- **reazonspeech-k2-v2 on the GPU.** It needs a CUDA build of sherpa-onnx that PyPI does not publish, and a device
  the package does not take by default.
- **Kotoba-Whisper v2.2's pipeline whole.** Its diarization needs gated models and an account, for no change in the
  words.
