---
name: accepted-spellings
description: Annotates Japanese speech recognition reference sentences with the reading of every part not in kana and the other spellings of the same speech (numbers in kanji or digits, kana or kanji, katakana variants, okurigana, fillers left out), for speech-bench's error rate with accepted spellings. Use when asked to annotate the sentences of items.jsonl in a speech-bench work directory, including 許す書き方, 読み, ルビ, 表記ゆれ, 注釈. Not for changing the scoring code or for measuring models.
---

# Accepted spellings

You rewrite each reference sentence in a notation that adds, without changing a character of it:

- the reading in kana of every part that is not kana: `明日《あした》`, `｜Zoom《ズーム》`;
- the other spellings of a stretch that the readings do not give: `［九《く》時《じ》／9時］`;
- stretches that may be left out: `［えーと／えっと／］`.

The bench then accepts a transcription that writes the sentence as written, any part in the kana of its
reading (hiragana and katakana alike), a bracketed stretch as one of its other spellings, or without an
optional stretch. Everything else counts as an error. So:

- a missing or wrong reading counts a correct kana transcription as wrong;
- a spelling accepted wrongly hides a real mishearing. This is the worse mistake.

You see only the reference: the annotations describe the sentence, not what any recognizer wrote, so that
every model is scored alike.

Before the first sentence, read [references/criteria.md](references/criteria.md) in full, which says how
to decide, and [references/notation.md](references/notation.md), which says exactly how to write it.

## Files

All in the work directory you are started in:

- `items.jsonl`: one JSON object per sentence, `sentence` (its sha256) and `reference`. Never edit it.
- `spellings.jsonl`: your annotations, written only by `add.ts`. Never edit it by hand.
- `chunk.txt`: yours, overwritten for each chunk.

Write no other file: notes go into the lines, and the report goes into your final message.

## Work in chunks of 25 sentences

The scripts are in `.agents/skills/accepted-spellings/scripts/`; run them with `node`.

1. Show the chunk: `node .agents/skills/accepted-spellings/scripts/show.ts items.jsonl --from N --count 25`.
   Sentences are numbered from 0, so the first chunk is `--from 0`, the next `--from 25`. Each line is the
   number of a sentence, a tab and the sentence.
2. Write `chunk.txt`, one line per sentence: its number, a tab, the annotated sentence and, when you have
   one, a tab and a note. Copy each sentence exactly and only add marks. Write the file with a heredoc
   whose delimiter is quoted (`<<'EOF'`).
3. Add it: `node .agents/skills/accepted-spellings/scripts/add.ts items.jsonl spellings.jsonl chunk.txt`.
   It checks every line and writes nothing while any line is wrong; fix what it lists and run it again
   until it says `Wrote`. If it names sentences not annotated yet, annotate them before going on.
4. Go on with the next chunk until the last sentence.

## Finish

Run `node .agents/skills/accepted-spellings/scripts/check.ts items.jsonl spellings.jsonl`. You are done only
when it ends with `No errors.` Report the counts it prints, and the sentences you were unsure about or that
look mistyped, with why.
