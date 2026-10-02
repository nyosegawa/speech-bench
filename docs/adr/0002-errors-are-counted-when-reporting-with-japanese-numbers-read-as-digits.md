# Errors are counted when reporting, with Japanese numbers read as digits

Speech recognition no longer reads numbers as digits (docs/adr/0015); the scoring of synthesized speech still
does. Errors are still counted when reporting.

A result file keeps the reference and the text of every utterance or sentence, and the report counts the
errors from them each time it runs. When the scoring rules change, every result, however old, is scored by
the new rules, and results measured before and after the change stay comparable. The errors formats 1 to 3
stored are left unread.

In Japanese, kanji numerals are read as Arabic digits on both sides before comparing, with the large units
万, 億 and 兆 kept as written: 百四十八円 counts as 148円, 八二六四 as 8264 and 三百五十万円 as 350万円. A reader,
whether a person or the language model a transcription goes to, takes 一ドル and 1ドル alike, so the difference
is not an error of recognition or of reading aloud. FLEURS and the synthesis sentences write numbers in digits,
while parakeet-ja, ReazonSpeech and Qwen3-ASR hearing synthesized speech often write kanji.

## Rejected

- **Storing the errors in the result file.** A change of the rules would leave old results scored by old
  rules beside new ones, with nothing in a table to tell them apart.
- **Comparing readings in kana through a morphological analyzer.** It would also forgive words written in
  other kanji, which are real errors, and it adds a dictionary to pin.
- **Leaving numbers as written, as the public benchmarks do.** They score style differences as errors, which
  would rank models by how they write numbers rather than by what they heard.

## Measured

2026-09-30, the runs of docs/measurements, before and after the change:

| Run | Before | After |
|---|---|---|
| Qwen3-ASR 1.7B, FLEURS ja, cut like ASIST | 5.66% | 5.31% |
| parakeet-tdt_ctc-0.6b-ja, same | 8.60% | 8.18% |
| ReazonSpeech NeMo v2, same | 7.82% | 7.32% |
| Qwen3-TTS 0.6B, heard | 9.93% | 6.30% |
| Qwen3-TTS 1.7B, heard | 6.62% | 3.98% |
| Irodori-TTS v4 Small 16 steps, heard | 4.64% | 2.49% |

## Known limits

- A word that contains a numeral changes on both sides alike (一緒 becomes 1緒), so it stays equal; a
  model that writes such a word in kana against a reference in kanji is counted as before.
- Digits read one by one and a positional number are not told apart when they mean different numbers
  (二十六四 is read as 24).
