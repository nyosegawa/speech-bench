# A speech-LLM is measured with its model card's instruction and its runtimes' own, decoding greedily

Nemotron 3.5 Transcribe writes what its instruction asks for, and every request carries one. Each of its runtimes is
measured with two, which the catalog holds and a result records among the runtime's options, with `temperature` 0 and
`reasoning` off:

- **The card's**, under the plain ids: the instruction NVIDIA's model card recommends for verbatim transcription,
  multilingual included, and gave every ASR benchmark it reports, FLEURS and Common Voice among them, "Audio
  transcription. Language: as spoken. Wording: verbatim, including fillers and repetitions. Formatting: punctuation
  and capitalization. Output: transcript only."
- **The runtimes'**, under ids ending in `-runtime-instruction`: the one mlx-audio and NeMo-Speech.cpp both write when
  given none, "Produce a verbatim transcript of the audio. Preserve named entities, abbreviations, numbers, dates,
  measurements, acronyms, and technical terms as clearly as possible. Keep the same language as spoken and do not
  translate.", which the card does not mention. It is passed as an instruction too, so that NeMo-Speech.cpp neither
  adds the language to it nor transcribes an empty answer once more with another instruction, as it does when it
  writes it itself.

The instruction goes in the user's turn before the audio, `<instruction> <|audio|>`, after an empty system turn and
with thinking off, `<think></think>`, which is how both runtimes write NeMo's `nemotron3p5` prompt. Decoding is greedy,
as the card gives transcription. The model is not told the language: both instructions say to keep it as spoken, and a
request's language is only checked against the languages the card marks for transcription.

mlx-audio runs the model through an adapter of its own, `adapters/mlx-audio-asr/`, pinned at 92decb75, the commit the
MLX conversion it runs was made and checked with, apart from the adapter of its Irodori-TTS, so that the synthesis
entries stay at the commit they were measured at. The conversion is nativ-community's at c47153ca: the language model in
affine 4-bit with groups of 64, the speech and speaker encoders unquantized and the MTP heads left out, loaded with
`strict=True` as its card loads it. It was made from the early-access checkpoint of NVIDIA's NGC, not from the release
on Hugging Face that NeMo-Speech.cpp's file is converted from: their encoder and language-model weights lie about a
quarter apart in relative L2 distance, well beyond the 0.09 that 4-bit quantization moves them, and their projections
into the language model are unrelated matrices. Its entries are named `ea` for it, and compare runtimes on two
checkpoints. mlx-audio decodes at most 1,024 new tokens, and NeMo-Speech.cpp 32 and 10 for each
second of audio.

## Rejected

- **The card's instruction alone.** With it, mlx-audio's 4-bit conversion answered two of the first 100 English FLEURS
  utterances (12.0 and 13.5 s of clear speech) with no token at all, and with the runtimes' instruction transcribed both
  whole (2026-10-29); a port is compared with both.
- **Telling the model the language.** Neither instruction names one, and only NeMo-Speech.cpp's own way of writing the
  runtimes' instruction takes one.
- **NeMo-Speech.cpp's `/v1/audio/transcriptions`.** It takes no instruction (docs/adr/0033).
