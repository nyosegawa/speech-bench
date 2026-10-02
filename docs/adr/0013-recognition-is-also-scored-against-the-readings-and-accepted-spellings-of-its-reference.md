# Recognition is also scored against the readings and accepted spellings of its reference

Beside the plain error rate, the report gives for Japanese the errors left when a transcription may write the
same speech another way. Each reference sentence is annotated in one line of `spellings/<source>-<locale>.jsonl`:

- every scored part not written in kana carries its reading in kana, `明日《あした》`, `｜Zoom《ズーム》`, two
  where speakers say either;
- a stretch may list other spellings that the readings do not give, `［九《く》時《じ》／9時］`: numbers in kanji or
  digits, kanji for a word written in kana, other okurigana, other katakana renderings, the intended text of a
  clear typo;
- a stretch may be left out when its list ends empty, `［えーと／えっと／］`, which is how fillers are written.

A transcription is counted against the closest way through the reference: as written, any part in the kana of
its reading with hiragana and katakana alike, a bracketed stretch as one of its spellings, an optional one left
out. The denominator is the length of the reference as written. Another kanji with the same sound, another word
with the same meaning and another spoken form are not accepted, so homophones stay mishearings. The line holds
the reference itself, which taking the marks away gives back; its sha256 joins it to the utterances, so the
files keep no copy of the text. A run gets the rate once every utterance it heard is annotated, since a rate
over part of a set would not compare with the plain one; languages scored by word get none.

The texts are compared as NFKC in lower case without spaces and without the punctuation that is not read; the
marks that are read stay: % ‰ ° ¥ $ € £ & anywhere, and . : ~ - / between two numerals. Without them 27% and 27
compare equal.

## Rejected

- **Rules in the normalization**, such as reading kanji numerals as digits: applied to both sides without the
  sentence, they accept real errors, 十分 (enough) heard as 10分 and 一緒 written 1緒.
- **Comparing readings from a morphological analyzer.** Homophones would pass, and the analyzer's dictionary
  would have to be pinned and would make reading errors of its own.
- **A language model judging each transcription.** It gives a score rather than a count, depends on a large
  model, and does not give the same answer twice.
- **A mixed error rate counting a Latin word as one unit.** With readings, README written リードミ is no
  longer an error, and one unit for a Latin word beside one per kana, each a mora, weighs it less than a
  Japanese word.
- **Spans given as offsets into the reference.** Agents miscount characters, and a diff of offsets cannot be
  read.
- **Listing whole-sentence variants.** Their number multiplies with every stretch that has another spelling.

## Measured

FLEURS ja, the 650 recordings of the test split's 321 sentences, on an Apple M5, 2026-10-02, with annotations
made by gpt-6.1-sol from the references alone in two runs of the same instructions:

| Model | Plain CER, numbers read as digits | Accepted spellings, two runs |
|---|---|---|
| parakeet-tdt_ctc-0.6b-ja | 5.48% | 3.39%, 3.33% |
| Qwen3-ASR 1.7B | 5.56% | 3.70%, 3.71% |
| ReazonSpeech NeMo v2 | 7.15% | 5.09%, 5.03% |
| Qwen3-ASR 0.6B | 8.53% | 6.19%, 6.16% |

## Known limits

- A speaker who says something other than the reference, 思ってる for 思っている, is counted as an error for
  every model alike.
- The annotations are only as good as the agent that made them; nothing reviews them but the checks of the
  notation.
