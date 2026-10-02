# Common Voice is read from a pinned copy of version 8.0, decoded in WebAssembly

The bench measures the test split of Common Voice 8.0 Japanese, 4,483 clips, the one Japanese models report their
rates on (kotoba-whisper, ReazonSpeech). Mozilla no longer hands out old versions openly, to honour speakers who
withdrew their consent, so it is read from the copy at japanese-asr/ja_asr.common_voice_8_0 on Hugging Face,
pinned like every file by revision, size and sha256: one Parquet file holding each clip's file name, its MP3 and
its sentence. Clips are named by their file names and taken in the order of the file.

The Parquet file is read by hyparquet and the MP3 decoded by mpg123-decoder, both plain JavaScript or
WebAssembly, pinned as their npm tarballs with the packages they import and unpacked into the data folder; the
bench keeps no runtime dependency. Each clip is decoded once to a 16 kHz WAVE file, after which it is measured as
FLEURS is.

## Rejected

- **Version 27, downloaded by hand from Mozilla Data Collective.** It is the version Mozilla hands out, but no
  Japanese model reports on it yet, its archive holds the whole language in 15.4 GB, and no one else could fetch
  it as the bench pins it.
- **A decoder built for each system, such as ffmpeg.** Two builds can decode the same MP3 to different samples,
  and the bench compares machines; WebAssembly gives the same samples on both.

## Measured

2026-10-02, on an Apple M5: the copy matched its pinned sha256; all 4,483 clips are mono MP3 at 48 or 32 kHz,
6.48 hours in all, and decoded without error in 13 s. 4,481 of the sentences end in a `.`, after their own
punctuation where they have it, as in `。.`, which is not scored. None holds a digit: the sentences write numbers in
kanji.

## Known limits

- The copy is not Mozilla's and does not leave out the clips of speakers who withdrew their consent.
