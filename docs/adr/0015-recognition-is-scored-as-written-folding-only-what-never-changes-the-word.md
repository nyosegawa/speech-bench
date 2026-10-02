# Recognition is scored as written, folding only what never changes the word

The plain error rate of speech recognition compares a reference and a transcription after folding only what
never changes the word: NFKC, case, the traditional forms of the Jōyō kanji table into the forms in use (髓 as
髄), spaces, and the punctuation that is not read. The marks that are read stay: % ‰ ° ¥ $ € £ & anywhere, and
. : ~ - / between two numerals. Kanji numerals and digits, a long vowel mark and its vowel, % and パーセント are
compared as written. The plain rate then says whether a transcription is written as its reference is; the rate
with accepted spellings (docs/adr/0013) lets the ways of writing a sentence allows pass.

This replaces, for speech recognition, the reading of kanji numerals as digits (docs/adr/0002) and of a long
vowel mark as its vowel (docs/adr/0006). The scoring of synthesized speech keeps both until how it is scored is
settled; what it compares is a sentence the bench wrote, heard by one recognizer.

Folded without the sentence around them, those rules accepted real errors, and dropping % accepted one more:

| Reference | Transcription | Errors under the rules | In fact |
|---|---|---|---|
| それで十分です (enough) | それで10分です | 0 | a mishearing |
| 一緒に行こう | 1緒に行こう | 0 | a broken transcription |
| 残りは27%です | 残りは27です | 0 | a mishearing |

The traditional forms come from the parenthesized forms of the Jōyō kanji table, 364 of them, as
mimneko/kanji-data (CC0) gives them; NFKC folds 62 that are compatibility ideographs, and a table holds the other
302. They are folded only from the traditional form to the form in use: the other way would merge words, as 芸
(うん) with 藝.

## Rejected

- **Keeping the rules and adding accepted spellings beside them.** The rules would keep accepting the errors
  above in both rates.
- **Folding hiragana and katakana in the plain rate.** Which script a word is written in is writing; the rate
  with accepted spellings folds them.

## Measured

On an Apple M5, 2026-10-02, the plain rate under the rules of docs/adr/0002 and 0006, as written, and with the
accepted spellings in `spellings/`:

| Run | Rules | As written | Accepted spellings |
|---|---|---|---|
| parakeet-tdt_ctc-0.6b-ja, FLEURS ja, 650 | 5.48% | 5.61% | 3.37% |
| Qwen3-ASR 1.7B, same | 5.56% | 6.03% | 3.72% |
| ReazonSpeech NeMo v2, same | 7.15% | 7.31% | 5.06% |
| Qwen3-ASR 0.6B, same | 8.53% | 9.09% | 6.20% |
| Qwen3-ASR 1.7B, the author's 31 recordings | 8.39% | 11.14% | 3.03% |
| Qwen3-ASR 0.6B, same | 10.59% | 13.34% | 4.68% |
| parakeet-tdt_ctc-0.6b-ja, same | 11.28% | 12.38% | 4.40% |
| ReazonSpeech NeMo v2, same | 17.47% | 18.71% | 7.98% |

## Known limits

- Languages scored by word compare as before: NFKC, case, and punctuation and symbols as spaces.
- A kanji outside the Jōyō table keeps whatever form it is written in.
