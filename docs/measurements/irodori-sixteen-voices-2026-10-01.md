# Sixteen Irodori-TTS voices, 2026-10-01

Irodori-TTS v4 Small at 16 steps in audio.cpp v0.8.2 on the RTX 2080 (Vulkan). The speech was heard by
Qwen3-ASR 1.7B and scored by docs/adr/0002, 0006 and 0007; sameness of voice is the mean cosine similarity of
ERes2NetV2 speaker embeddings over takes with 1.5 s of voice or more (docs/adr/0005).

## Making the voices

- Each voice was described as a list of words (`prompts/designs-ja-JP.json`) and given ten lines it would
  say (`prompts/lines-<voice>-ja-JP.json`: seven statements, a greeting, a feeling and a question). The bright
  young woman is the voice of irodori-voice-from-a-set-2026-10-01.md, from 60 lines with seeds 1 to 3.
- With seeds 1 to 5, the 50 takes of the seven women held 24 to 179 pairs at 0.8 or more with different
  sentences, the eight men's 1 to 15; all their takes were 0.60 to 0.70 alike for the women and 0.53 to 0.62
  for the men. The men were given seeds 6 to 10 as well.
- The largest set in which every pair held had two to four takes for most voices, too few for more than one
  reference of 10 s. Candidates taken from all the takes instead (every pair at 0.8, no sentence twice, 10 s
  or more) gave three for twelve of the fifteen voices at five seeds; at ten seeds every man had one at
  least, the energetic and the fresh young man one each and the announcer two.
- Every candidate spoke the 20 sentences of `prompts/speak-ja-JP.json` with seeds 1 and 2. One, the second
  candidate of the gentle older woman, stopped at a long sentence: the slow voice made audio.cpp's codec
  graph ask for 5.2 GB, more than the 8 GB card had free. It was left out.
- The voices were chosen by ear on the voices page, one candidate each.

## The voices chosen

| Voice | Described as | Reference | Same voice | Like its reference | Heard CER | Broken takes | Pitch | Most alike other voice |
|---|---|---|---|---|---|---|---|---|
| bright young woman | 若い女性、明るい声、はっきりした話し方 | 15.8 s | 0.87 | 0.85 | 3.5% | 7 of 40 | 314 Hz | 0.71 calm young woman |
| soft young woman | 若い女性、ふんわりした柔らかい声、やさしい話し方 | 13.8 s | 0.87 | 0.88 | 1.8% | 0 of 40 | 314 Hz | 0.73 calm young woman |
| calm young woman | 若い女性、落ち着いた澄んだ声、知的で簡潔な話し方 | 13.0 s | 0.90 | 0.85 | 2.1% | 0 of 40 | 320 Hz | 0.73 soft young woman |
| bright adult woman | 大人の女性、明るく張りのある声、軽快な話し方 | 12.4 s | 0.92 | 0.89 | 2.2% | 2 of 40 | 239 Hz | 0.76 calm adult woman |
| announcer woman | 大人の女性、明瞭な声、アナウンサーのような正確な話し方 | 12.8 s | 0.91 | 0.93 | 2.3% | 3 of 40 | 246 Hz | 0.73 low adult woman |
| low adult woman | 大人の女性、低く柔らかい声、ゆったりした話し方 | 12.6 s | 0.90 | 0.90 | 3.5% | 6 of 40 | 200 Hz | 0.73 announcer woman |
| calm adult woman | 大人の女性、落ち着いた低めの声、上品な話し方 | 13.8 s | 0.88 | 0.88 | 3.6% | 5 of 40 | 190 Hz | 0.76 bright adult woman |
| gentle older woman | 年配の女性、温かく優しい声、ゆっくりした話し方 | 13.7 s | 0.89 | 0.85 | 2.7% | 4 of 40 | 193 Hz | 0.70 calm adult woman |
| energetic young man | 若い男性、元気で明るい声、はきはきした話し方 | 14.8 s | 0.89 | 0.86 | 2.5% | 4 of 40 | 200 Hz | 0.66 bright adult man |
| fresh young man | 若い男性、爽やかな声、はっきりした話し方 | 12.7 s | 0.90 | 0.87 | 3.0% | 4 of 40 | 167 Hz | 0.55 calm young man |
| calm young man | 若い男性、落ち着いた声、理知的で簡潔な話し方 | 12.3 s | 0.87 | 0.88 | 3.2% | 7 of 40 | 143 Hz | 0.72 bright adult man |
| bright adult man | 大人の男性、明るく張りのある声、軽快な話し方 | 11.0 s | 0.91 | 0.91 | 2.2% | 2 of 40 | 140 Hz | 0.78 announcer man |
| announcer man | 大人の男性、明瞭な声、アナウンサーのような正確な話し方 | 10.8 s | 0.89 | 0.85 | 3.3% | 4 of 40 | 188 Hz | 0.78 bright adult man |
| calm adult man | 大人の男性、落ち着いた低い声、丁寧な話し方 | 11.4 s | 0.89 | 0.87 | 4.6% | 8 of 40 | 91 Hz | 0.58 bright adult man |
| deep adult man | 大人の男性、低く渋い声、ゆったりした話し方 | 11.0 s | 0.92 | 0.86 | 2.6% | 4 of 40 | 120 Hz | 0.64 gentle older man |
| gentle older man | 年配の男性、穏やかで温かい声、ゆっくりした話し方 | 11.9 s | 0.88 | 0.85 | 3.2% | 1 of 40 | 148 Hz | 0.64 deep adult man |

- The sixteen are 0.43 alike on average and 0.78 at most, below the 0.8 at which takes of one description
  were heard as one voice; no woman is more than 0.47 like a man.
- The best candidates of the low adult woman and the calm adult woman, whose descriptions differ in a few
  words, were 0.86 alike; the candidates chosen are 0.50.
- Nearly all the broken takes are aizuchi.

## Aizuchi

Spoken like a reference, Irodori-TTS made the short aizuchi about a second longer than without one and
filled the time with other words (はい、そうよ。, なるほど、ごくじ。).

| Irodori-TTS v4 Small, 16 steps | はい。 heard more than 30% wrong | Median length of はい。 |
|---|---|---|
| No voice | 0 of 11 | 0.96 s |
| A description only | 6 of 20 | about 1.0 s |
| A reference | 50 of 95 | 2.08 s |

`tts --duration-scale` multiplies the predicted length. Fifteen of the voices, seeds 1 and 2, the takes heard
more than 30% wrong and the median length:

| Aizuchi | As predicted | × 0.7 | × 0.6 | × 0.5 |
|---|---|---|---|---|
| はい。 | 16 of 30, 2.08 s | 9 of 30, 1.48 s | 12 of 30, 1.24 s | 11 of 30, 1.04 s |
| あー。 | 19 of 30, 2.60 s | 13 of 30, 1.80 s | 12 of 30, 1.56 s | 12 of 30, 1.28 s |
| なるほど。 | 8 of 30, 2.52 s | 0 of 30, 1.76 s | 0 of 30, 1.52 s | 0 of 30, 1.28 s |
| うんうん。 | 11 of 30, 2.40 s | 15 of 30, 1.68 s | 15 of 30, 1.44 s | 13 of 30, 1.20 s |

- A shorter length helps but is not the whole cause: at × 0.5 はい。 is as long as without a voice and still
  breaks in 11 of 30 (はい、はい。, はい、アレベアです。). Shortened, うんうん。 is often said as one うん.
- The voices differ: the calm young woman broke no aizuchi as predicted, the calm adult man all eight, and
  five of eight at × 0.5.
- The bright young woman's aizuchi were the longest, 3.3 to 3.8 s, and broke in 7 of 8. At × 0.3 to × 0.7,
  はい。, なるほど。 and うんうん。 were heard right in 29 of 30 takes; five of ten あー。 were heard as a single あ.

## The voice files

The references are kept in `references/` of the data folder.

| Reference | sha256 |
|---|---|
| voice-announcer-man | c325c9c3c62ebcc81024ebf5be9b05bb841968c77a7264fb906435a8dd705974 |
| voice-announcer-woman | 433e2eadf3b1f383d8046116347230bfe29599ba7dff4719c550c9ea15910cc9 |
| voice-bright-adult-man | 2f51fb24ff79c7f14f08807966a3a363a92a113e8f1bcc149625463c791d16ef |
| voice-bright-adult-woman | 227d38cf014ee92e847ff27fcc1b8f99607f21df8525a5cae6ddd3c6dbd55cb8 |
| voice-bright-young-woman | 0854fd856bb2d7c4424786553a32e1f3850751079e29265f3012de5de58b2dc0 |
| voice-calm-adult-man | fc8e0e5fff1dfcaeaf4d84e04b21dc8aacbfc55f165425acab51ad9043aa2b32 |
| voice-calm-adult-woman | 577690e07ea6513711552a363c07215962eca90250853537311dfbd59f3424a7 |
| voice-calm-young-man | 4efbe7166d948afe85a48d9d082e3ae0eff57567925ababf9dfd43b62626ce7f |
| voice-calm-young-woman | 1e955f2fdc3e186a1b1aa37eeaf13d7ae743ee0934a1a8cb7f630d9e32af6ffa |
| voice-deep-adult-man | bfd37e80a2628c2b86493501b5387621b8977ef7e9ff8f5807881ea732fedb23 |
| voice-energetic-young-man | 9610b1509c866fa9bdaf9ac1d28bb8729d5f23f36c6e4daf629fa943b784b348 |
| voice-fresh-young-man | c8521b318896bf7edf20a5fe04e9fee5cc7a4e6066fd8d4b158c41c9108ca411 |
| voice-gentle-older-man | 22dff4fb65fee9076716c1a3470efbac1356b7560860273f236db6c0b2ab2174 |
| voice-gentle-older-woman | e6ed7fbc06b548f1c79f518a444c07007998176eeadbce54d5d2d07c40f27c33 |
| voice-low-adult-woman | 66b4fd3ad8d9405090f6dfab26041c6b88c2076c7c91047015fb289e2d81ec42 |
| voice-soft-young-woman | 305b8ac2571af8b7d2657d9f004b9571f6e2d6cc65d203c14157ab3d5bd2f2af |
