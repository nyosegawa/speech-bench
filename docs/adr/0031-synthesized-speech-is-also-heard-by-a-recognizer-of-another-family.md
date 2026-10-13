# Synthesized speech is also heard by a recognizer of another family

A synthesis run transcribes its speech twice, after the synthesis model has stopped: with Qwen3-ASR 1.7B in
llama.cpp, whose heard error rate the bench has reported from the start, and with ReazonSpeech NeMo v2 in speech.cpp
(result format 20). The report gives both rates side by side, and the pages keep judging takes by the first.

Qwen3-TTS and Qwen3-ASR come from one family, trained by one team on data that may overlap, and a recognizer can hear
the speech of its own family more kindly than a listener would. ReazonSpeech NeMo v2 is a FastConformer trained on
ReazonSpeech's Japanese broadcasts, another architecture on other data. It runs with its checkpoint's beam search, the
model's default, in the release of speech.cpp the bench pins rather than the build a run measures, so that the
second rate of two builds is counted by the same ears; the run records the runtime it ran in. It transcribes Japanese
alone, so a run of another language records no second recognizer.

## Rejected

- **Replacing Qwen3-ASR as the recognizer.** Every run so far was heard by it, and the pages, the voices and the
  reference voices were chosen by its rate; the second rate stands beside it.
- **ReazonSpeech in the build a run measures.** A defect of a candidate build would then show in the rate of every
  model it heard.
- **Greedy decoding.** It is not what the model does by default.
