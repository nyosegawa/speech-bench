# Utterances ASIST's VAD drops are recorded and left out of the error rate

When an utterance is cut like ASIST (docs/adr/0001) and ASIST's VAD keeps no capture of it, no model hears
it: the run writes a record with `droppedBy: "asist-vad"` in place of a transcription, and the report shows
the number of such utterances in a column of its own. The error rate, the empty transcriptions and the
timings are counted over the utterances the model heard.

A dropped utterance is what ASIST does to the speech before any model sees it, and the same utterances drop
for every model, since the VAD does not depend on the model. Counting them in the error rate would add the
same amount to every model and hide how the models differ; leaving them out without a trace would hide that
ASIST loses the utterance.

## Rejected

- **Stopping the run at a dropped utterance.** One short answer made a speaker's whole set impossible to
  measure.
- **Counting a dropped utterance as a transcription with every character deleted.** It measures ASIST's VAD
  inside each model's error rate.
- **Sending the dropped utterance as recorded.** ASIST never sends it, so the result would describe speech
  recognition no user of ASIST gets.

## Measured

2026-09-30, the author's recording of はい (2.09 s, loudest sample −17 dBFS), scaled to a peak of 0.9 as the
bench scales every recording: 11 frames of 341 samples, 234 ms, rise above the VAD's threshold, fewer than
the 250 ms of voice ASIST requires to keep a capture. The other 30 of the author's 31 recordings are kept.
