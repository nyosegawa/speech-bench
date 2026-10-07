# An RNN-T model's greedy decoding is measured as an entry of its own

speech.cpp's main branch decodes reazonspeech-nemo-v2 greedily when a request sets `decoding` to `greedy`, its beam
search staying the default (speech.cpp's docs/adr/0021), and whether the option is released waits for its accuracy and
wait on Common Voice 8.0 Japanese. The bench measures it as a model of the catalog of its own,
`reazonspeech-nemo-v2-greedy-speech.cpp`, on the same file as `reazonspeech-nemo-v2-speech.cpp`: every `transcribe` of
the greedy entry carries `decoding: greedy`, and the other entry sends no `decoding` and decodes as the model does by
default. The worker's `ready` must offer the entry's decoding among the choices of the model's `decoding` option, or
the run stops before an utterance is measured; v0.7.1 offers none, so the greedy entry runs in a local build of main
(docs/adr/0019).

## Rejected

- **A `--decoding` flag on `asr`.** The result would need the option in its form and the report and every page a
  place for it, where an entry's id and label tell the two apart everywhere already, as Irodori-TTS's steps do.
- **Sending `decoding: beam` for the default entry.** A worker refuses a member that is not one of its options, so
  the entry would no longer run in v0.7.1, in which it has been measured.
