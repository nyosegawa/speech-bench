# Utterances without voice are recorded and left out of the error rate

When an utterance is trimmed to its voice (docs/adr/0001) and Silero VAD finds no voice in it, no model hears
it: the run writes a record with `droppedBy: "no-voice"` in place of a transcription, and the report shows the
number of such utterances in a column of its own. The error rate, the empty transcriptions and the timings are
counted over the utterances the models heard. Runs of formats 5 to 10, which cut utterances like ASIST's VAD,
record the utterances it dropped the same way, with `droppedBy: "asist-vad"`.

The same utterances drop for every model, since the VAD does not depend on the model. Counting them in the
error rate would add the same amount to every model and hide how the models differ; leaving them out without
a trace would hide that a recording has a problem.

## Rejected

- **Stopping the run at such an utterance.** One silent or broken recording would make a whole set
  impossible to measure.
- **Counting it as a transcription with every character deleted.** It would measure the VAD inside each
  model's error rate.
- **Sending it as recorded.** The other utterances are trimmed, so it would be the one utterance heard under
  other conditions.

## Measured

2026-10-01, Silero VAD v4 through sherpa-onnx 1.13.8: it found voice in all of the first 100 recordings of the
Japanese FLEURS test split and in all 31 of the author's recordings, the shortest a はい with 0.23 s of voice.
