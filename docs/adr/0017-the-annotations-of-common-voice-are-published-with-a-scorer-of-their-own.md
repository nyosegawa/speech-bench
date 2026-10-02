# The annotations of Common Voice are published with a scorer of their own

The annotations of the test split of Common Voice 8.0 Japanese are published on Hugging Face as
sakasegawa/common-voice-ja-accepted-spellings, so that anyone measuring Japanese recognition on that split can
count errors against them. The dataset has a config for each version of Common Voice, `8.0` now, and a row for each
clip: the clip's file name, which is the same in Mozilla's release and in the copy the bench reads, the sentence and
its sha256, the annotation in the notation of docs/adr/0013, the same read into stretches of pieces with their
readings and other spellings, the note, and who made it with which skill when. They are CC0, as Common Voice is, so
joining them with the clips adds no condition.

`score.py` beside them counts in Python, with nothing but its standard library, as the bench does: as written and
with accepted spellings. A test runs it against the bench on annotated sentences of FLEURS and transcriptions made
from them, read in kana, spelled otherwise, left out and edited, so that the two count alike.

The annotations of FLEURS and of the bench's prompts stay in the repository: a dataset of one corpus is easier to
use, and the bench reads them from there.

## Rejected

- **Ranges given by offsets into the sentence.** They cannot be read without a tool, and a language model counts
  positions wrong.
- **Choices written into the sentence, as sclite's `{ 十 / 10 / @ }`.** Existing tools read them, but with a
  reading on every kanji the sentence is no longer readable.
- **Joining on the row of the copy.** Another revision of the copy can order its rows otherwise; the file name of a
  clip is Mozilla's own.
- **CC-BY 4.0**, which asks every user to credit the annotations of sentences that are themselves CC0.

## Measured

2026-10-03: on the 17,932 transcriptions of the four Japanese models of
docs/measurements/asr-on-common-voice-8-ja-2026-10-03.md, `score.py` counted the same errors as the bench for every
one, as written and with accepted spellings, under Python 3.11. Python 3.9.6 and 3.13.13 gave the same rates for the
four models.

## Known limits

- No person reviewed the annotations (docs/adr/0014).
- `score.py` groups a character with the marks that extend it rather than following every rule of grapheme
  clusters, which Japanese text does not need, and reads characters with the Unicode version of its Python.
