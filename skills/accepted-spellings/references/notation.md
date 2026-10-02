# The notation

Contents: readings; other spellings; the chunk file; what add.ts reports.

An annotated sentence is the reference with marks added. Taking the marks and what they enclose away
(readings, ／ and the other spellings after it) must leave the reference exactly; `add.ts` checks this.

## Readings

- `漢字《よみ》` gives the reading of the run of kanji just before 《, back to the previous mark or the
  previous character that is not kanji: in `今日《きょう》は`, the base is 今日.
- `｜base《よみ》` gives the reading of everything from ｜ to 《. Use it for every base that is not a run of
  kanji (Latin letters, digits, marks, a base mixing them with kanji) and to cut a run of kanji: `｜Zoom《ズーム》`,
  `｜11《じゅういち》月《がつ》`, `｜%《パーセント》`, `｜7:15《しちじじゅうごふん》`.
- Two readings: `一日《ついたち／いちにち》`.
- A reading is kana only, hiragana or katakana. A base in kana takes no reading.

Every character that is not kana and is scored needs to sit in a base: kanji, Latin letters, digits, and
the marks read aloud (% ‰ ° ¥ $ € £ &, and . : ~ - / between two numerals). Punctuation that is not read
(、。「」()・!? and the comma grouping digits) and spaces need none.

## Other spellings

- `［as written／other／other］` lists other spellings of the whole stretch. The part before the first ／
  is the reference as written, with its readings; the parts after it are plain text, without readings.
- An empty last part means the stretch may be left out: `［えーと／えっと／］`, `［まあ／］`.
- Brackets do not nest. When a combination is needed, list it whole:
  `［｜120《ひゃくにじゅう》万《まん》／百二十万／1200000］`.
- Do not list what the readings already give: `［今日《きょう》／きょう］` is refused.

## The chunk file

One line per sentence: the number `show.ts` printed, a tab, the annotated sentence, and optionally a tab
and a short English note.

```text
0	明日《あした》は［九《く》時《じ》／9時］から［受《う》け付《つ》け／受付］で［申《もう》し込《こ》み／申込み］を始《はじ》めます。
1	［｜1《ひと》つ／一つ］目《め》の駅《えき》で降《お》りて［ください／下さい］。
2	会《かい》費《ひ》は［｜1200《せんにひゃく》／千二百］円《えん》で、参《さん》加《か》者《しゃ》の［｜8《はち》／八］割《わり》が｜Zoom《ズーム》で出《しゅっ》席《せき》しました。
3	［えーと／えっと／］、［まあ／］、資《し》料《りょう》は［すでに／既に］送《おく》りました。
4	消《しょう》費《ひ》税《ぜい》は［｜10《じゅっ》／十］｜%《パーセント》です。
5	この結《けっ》果《か》は［以《い》外《がい》／意外］でした。	以外 is a typo for 意外 (unexpected); the intended text is added.
```

## What add.ts reports

- `without the marks the line reads …`: a character of the reference was changed, dropped or added; copy
  the sentence again.
- `… has no reading`: a kanji, Latin letter, digit or read mark sits outside every base.
- `《…》 follows no kanji; put ｜ where its base starts`: the base is not a run of kanji.
- `is not kana only`, `is written in kana already and takes no reading`.
- `gives no other spelling`, `brackets do not nest`, `is scored the same as the stretch as written`,
  `is what the readings give already`.
- `Not annotated yet, though later sentences are: …`: a sentence was skipped; annotate it.
- `contains a character of the notation`: report the sentence; it cannot be annotated.
