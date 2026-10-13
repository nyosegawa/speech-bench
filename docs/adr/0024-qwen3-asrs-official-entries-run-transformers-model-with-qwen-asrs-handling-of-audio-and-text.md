# Qwen3-ASR's official entries run transformers' model with qwen-asr's handling of audio and text

`qwen3-asr-0.6b-official` and `qwen3-asr-1.7b-official` run Qwen3-ASR as speech.cpp's reference dumps run it, from
the same checkpoints at the same revisions: transformers 5.18's own Qwen3ASRForConditionalGeneration, given the
checkpoint's configuration and its weights renamed from qwen-asr's names, and, from qwen-asr 0.0.6, what transformers
does not do, as qwen-asr's `transcribe()` runs it: the normalization of the audio, the split of audio over 1200 s, the
prompt with its system turn, and the parse of the output. The adapter loads only qwen-asr's `inference/utils.py`, since
importing the package imports its own copy of the model, which needs transformers 4.57.6. Decoding is greedy with the
checkpoint's `generation_config.json` and at most 4096 new tokens, the most qwen-asr's vLLM backend writes and speech.cpp
writes.

The entries are told the language as the speech.cpp and llama.cpp entries of Qwen3-ASR are: the set's language goes
into the prompt as the start of the answer, `language Japanese<asr_text>`, and the text after it is the transcription.
The model's information declares that the language steers it, as the catalog's `languageHint` says.

The encoder attends within windows of 8 s, which the model was trained with and qwen-asr's FlashAttention 2 path and
vLLM backend keep. The speech.cpp port is checked against the same arithmetic, so the official entries tell its
departures from the model apart from those of the way it runs.

On an Apple M5 through MPS in BF16 (2026-10-13), the 0.6B and 1.7B adapters gave the texts of speech.cpp's FP32
reference dumps on the CPU, character for character, for the three Japanese FLEURS utterances the dumps hold with the
language forced (one, two and three windows long).

## Rejected

- **qwen-asr's transformers backend as released.** Without FlashAttention 2 its encoder is given no mask for its
  windows and attends over the whole utterance, so any utterance over 8 s is heard otherwise than the model was
  trained to. FlashAttention 2 runs on neither an Apple GPU nor an RTX 2080, the GPUs the bench runs on.
- **qwen-asr's vLLM backend.** vLLM runs on neither macOS nor Windows.
- **transformers' converted checkpoints (`-hf` repositories).** They hold the same tensors under other names, but
  speech.cpp converts and checks against Qwen's own repositories, and the bench measures the same files.
