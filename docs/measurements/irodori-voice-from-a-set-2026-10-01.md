# One Irodori-TTS voice, gathered from a set and cloned, 2026-10-01

Irodori-TTS v4 Small at 16 steps on the RTX 2080 (Vulkan), audio.cpp v0.8.2. Sameness of voice is the mean
cosine similarity of the ERes2NetV2 speaker embeddings of every pair of a run's sentences with 1.5 s of voice
or more (docs/adr/0005): one real speaker's recordings are 0.84 alike and 0.33 like other men's, Qwen3-TTS's
ono_anna 0.76.

## Gathering the voice

- Described as 若い女性、明るい声、はっきりした話し方 (`young-woman-words`), the 60 lines of
  `prompts/lines-bright-young-woman-ja-JP.json` were spoken with seeds 1 to 3: 180 takes in about 5 minutes,
  heard at 3.3 to 3.6% CER.
- Of every pair of the 180, 6.2% were 0.8 or more alike. The largest set in which every pair is at least 0.8,
  one take per sentence, had 12 takes, 75 s, 0.84 alike on average and 0.81 at the least; all but two were of
  seed 2. By ear, pairs at 0.8 or more sound very close.
- A set held only around its center at 0.8 had 30 takes whose least alike pair was 0.63, so the set is held
  by every pair.
- The same voice rates a sentence it says twice about 0.07 more alike than two different sentences
  (ono_anna, M5 against RTX 2080: 0.82 and 0.85 against 0.74 and 0.78), so a set takes one take per sentence.
  Without that rule the largest set of 57 undescribed takes was six seeds of one sentence.

## Speaking like it

The 20 sentences of `prompts/speak-ja-JP.json`, including the formal ones that turned the described voice
away from the description:

| Voice given | Same voice | Like the 30 s reference | Pitch spread | Heard CER | Median first audio |
|---|---|---|---|---|---|
| Description, seed 1 | 0.59 | 0.51 | 2.5 st | 2.2% | 0.91 s |
| Description, seed 2 | 0.62 | 0.63 | 2.4 st | 2.5% | 0.92 s |
| Reference of 10.7 s (2 takes) | 0.88 | 0.81 | 1.7 st | 2.2% | 1.05 s |
| Reference of 32.1 s (6 takes) | 0.86 | 0.84 | 1.2 st | 2.2% | 1.10 s |
| Description and the 32.1 s reference | 0.86 | 0.85 | 1.7 st | 2.5% | 1.27 s |

- A reference holds the voice through every sentence, more alike than ono_anna and one real speaker's
  recordings. By ear the 10 s reference sounded best.
- The reference costs 0.1 to 0.2 s a sentence and no errors. No sentence ended in an added phrase, which
  audio.cpp's documentation warns of for v4 references; the only sentence heard with more than 30% wrong was
  あー。 heard as ああ。.
- Describing the voice as well as giving the reference did not help and cost another 0.2 s.
- A reference of 69 s failed: audio.cpp's codec encode graph did not fit its default arena of 512 MiB.
