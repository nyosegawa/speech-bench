# A Japanese long vowel mark is read as the vowel it lengthens

In Japanese, each long vowel mark ー is written as the vowel of the kana before it, in that kana's script,
before a reference and a transcription are compared: あー counts as ああ and コーヒー as コオヒイ. The rule
applies to speech recognition and to the speech a synthesis model made alike, and, as with numbers
(docs/adr/0002), to every result however old, since the errors are counted when reporting.

Recognizers write a drawn-out vowel either way. Qwen3-ASR 1.7B heard Irodori-TTS's あー。 as ああ。 in 36 of the
95 takes spoken like a reference voice on 2026-10-01; each was counted as one error in two characters, which
the listening and voices pages take for a broken take. A reader, whether a person or the language model a
transcription goes to, takes the two alike.

## Rejected

- **Leaving the mark out on both sides.** あー would become あ and still differ from ああ.
- **Comparing readings in kana through a morphological analyzer**, for the reasons in docs/adr/0002.

## Measured

2026-10-01, the latest run of each model on each machine, before and after the change.

| Run | Before | After |
|---|---|---|
| Qwen3-ASR 1.7B, FLEURS ja-JP, Apple M5 | 5.31% | 5.31% |
| parakeet-tdt_ctc-0.6b-ja, same | 8.18% | 8.16% |
| ReazonSpeech NeMo v2, same | 7.32% | 7.30% |
| ReazonSpeech NeMo v2, the author's recordings | 17.93% | 17.79% |
| Irodori-TTS v4 Small 16 steps, heard, Apple M5 | 2.49% | 2.32% |
| Qwen3-TTS 1.7B, heard, Apple M5 | 3.98% | 3.81% |
| あー。 spoken like a reference voice, heard more than 30% wrong | 92 of 95 | 56 of 95 |

## Known limits

- A mark after a kana without a vowel of its own (ん, っ) or after a character that is not a kana stays as
  written.
- A long vowel written with another kana, such as とおり and とうり, is not touched and counts as an error.
