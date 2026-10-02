---
license: cc0-1.0
language:
- ja
pretty_name: Common Voice Japanese accepted spellings
task_categories:
- automatic-speech-recognition
tags:
- evaluation
- character-error-rate
- furigana
size_categories:
- 1K<n<10K
configs:
- config_name: '8.0'
  data_files:
  - split: test
    path: 8.0/test.jsonl
---

# Common Voice Japanese accepted spellings

Japanese writes the same speech in many ways, such as 昨日 or きのう, 八時間 or 8時間, and 綺麗 or きれい, and a
character error rate counted against the reference as written calls each of them an error. This dataset annotates
every sentence of the test split of Common Voice 8.0 Japanese with the readings of its kanji, numerals and Latin
letters and the other spellings of its words, so that a transcription can be scored against the closest way of
writing what was said.

On this split, all 4,483 clips as recorded, measured with [speech-bench](https://github.com/nyosegawa/speech-bench)
on 2026-10-03 (Q8_0 weights, an RTX 2080 with Vulkan):

| Model | CER as written | CER with accepted spellings |
|---|---|---|
| Qwen3-ASR 1.7B | 9.25% | 4.56% |
| Qwen3-ASR 0.6B | 11.77% | 6.88% |
| parakeet-tdt_ctc-0.6b-ja | 9.26% | 4.55% |
| ReazonSpeech NeMo v2 | 14.00% | 9.26% |

Every model wrote 私 for the わたし of the sentences in 130 to 135 clips, the other spelling taken most often by all
four.

## Rows

One row for each of the 4,483 clips, in the order of the copy named below:

```json
{
  "clip": "common_voice_ja_19485569.mp3",
  "sentence": "きのうは八時間寝ました。.",
  "sentence_sha256": "798ff6285abc400168a5a551adf8e9c230d82a0c8cc8d7fff64faec5c31f8437",
  "annotation": "［きのう／昨日］は［八《はち》／8］時《じ》間《かん》寝《ね》ました。.",
  "segments": [
    {"bracketed": true, "optional": false, "spellings": ["昨日"], "pieces": [{"text": "きのう", "readings": []}]},
    {"bracketed": false, "optional": false, "spellings": [], "pieces": [{"text": "は", "readings": []}]},
    {"bracketed": true, "optional": false, "spellings": ["8"], "pieces": [{"text": "八", "readings": ["はち"]}]},
    {"bracketed": false, "optional": false, "spellings": [], "pieces": [
      {"text": "時", "readings": ["じ"]}, {"text": "間", "readings": ["かん"]},
      {"text": "寝", "readings": ["ね"]}, {"text": "ました。.", "readings": []}]}
  ],
  "note": null,
  "annotator": "codex-cli 0.160.0 gpt-6.1-sol medium",
  "skill": "dca9bf7",
  "annotated_at": "2026-10-02"
}
```

| Field | What it holds |
|---|---|
| `clip` | The file name of the clip in Common Voice 8.0. |
| `sentence` | The sentence of the clip. |
| `sentence_sha256` | The sha256 of `sentence` in UTF-8. |
| `annotation` | The sentence with its readings and other spellings, in the notation below. |
| `segments` | The annotation read: the stretches of the sentence in order, each made of pieces with their text and readings. A bracketed stretch has its other spellings, and is `optional` when it may be left out. The texts of the pieces give back the sentence. |
| `note` | What the annotator noted about the sentence, such as a typo whose intended word it accepted, or null. |
| `annotator` | The agent and its version, the model and its reasoning effort. |
| `skill` | The commit of nyosegawa/speech-bench whose `skills/accepted-spellings` made the row. |
| `annotated_at` | The day the row was made. |

Of the 4,483 sentences, 4,350 have readings, 1,649 have other spellings, 13 have a stretch that may be left out, and
79 have a note.

## Notation

- `漢字《かんじ》` gives the reading in kana of the run of kanji right before it. `｜` marks where a base that is not
  such a run starts, as in `｜Zoom《ズーム》`, and `／` separates two readings, as in `一日《ついたち／いちにち》`.
- `［as written／other／…］` gives other spellings of the whole stretch. An empty last spelling means the stretch may
  be left out, as a filler may. Brackets do not nest; the readings inside them belong to the stretch as written.
- Taking the marks away gives back the sentence.

## Scoring

Both rates divide the errors of all transcriptions by the length of their references, and fold both texts the same
way first: grapheme clusters after NFKC and lower case, with the traditional forms of the Jōyō kanji table in their
forms in use, and without spaces and the punctuation and symbols that are not read aloud. % ‰ ° ¥ $ € £ & stay,
and . : ~ 〜 - − / between two numerals, so that 27% and 27 differ.

- **As written**: the edit distance to the sentence.
- **With accepted spellings**: the edit distance to the closest way through the sentence, in which each piece may
  be written as it is or in the kana of any of its readings, hiragana and katakana alike, each bracketed stretch as
  one of its other spellings, and an optional stretch left out. Another kanji with the same reading stays an error.
  The length stays that of the sentence as written.

`score.py` counts both, with Python 3.9 or later and nothing else, as speech-bench does: the two counted the same
errors for each of the 17,932 transcriptions of the table above, and a test there checks that they keep doing so.

```sh
python score.py 8.0/test.jsonl transcriptions.jsonl
```

`transcriptions.jsonl` holds one JSON object per line: the `clip` that was heard, or the `reference` sentence, and
the `text` a model wrote. `--each` prints the errors of every transcription.

## How the annotations were made

Codex (gpt-6.1-sol, reasoning effort medium) annotated them with the skill in `skills/accepted-spellings` of
speech-bench, from each sentence alone: it saw no audio and no transcription, so that the annotations favor no
recognizer. Each session took up to 1,000 sentences and checked every line with speech-bench's parser, which refuses a
line that does not give back its sentence or leaves a scored character other than kana without a reading. No
person reviewed them.

They accept numerals in digits or kanji, other okurigana, kana for a word written in kanji and the reverse,
other katakana spellings of a loanword, and the intended word for a clear typo of the sentence. They do not accept
another kanji of the same reading, another spoken form (思ってる for 思っている), or another way of saying a number
(半 for 三十分).

## Audio

The clips are not included. They can be read from
[japanese-asr/ja_asr.common_voice_8_0](https://huggingface.co/datasets/japanese-asr/ja_asr.common_voice_8_0) and
joined on `clip`, the `path` of its `audio`. That copy is not Mozilla's and does not leave out the clips of
speakers who withdrew their consent after its release; Mozilla now hands out Common Voice through
[Mozilla Data Collective](https://mozilladatacollective.com). Do not try to identify the speakers.

The sentences are those of the copy. 4,481 of them end in a `.`, after their own punctuation where they have it, as
in `。.`; no score counts it.

## License

CC0 1.0, as Common Voice.
