# What ASIST hears is recorded inside the running app

`asist-input` records the frames ASIST's VAD receives in the installed app, over the DevTools protocol of
an ASIST started with `--remote-debugging-port`. The session presses ASIST's microphone button with a
breakpoint in the button's handler, which pauses once to copy the voice controller and the speech player to
a global; after that, the VAD instance's `push`, `effectiveHangover` and end of capture are wrapped, and every frame is queued with the
noise floor, the playback boost, Silero's probability, the hangover and how a capture ended. Nothing in
ASIST changes, and the tap comes off when the session ends.

ASIST hears through macOS voice processing and DeepFilterNet, or through Chromium's echo cancellation,
noise suppression and automatic gain. None of these can be reproduced outside the app, and the level at
the VAD, which decides what ASIST drops, is what the bench's own recordings cannot tell.

## Rejected

- **Recording the microphone outside ASIST with the same processing.** getUserMedia in a browser page
  would come close for one of the two captures, but the native helper's voice processing depends on the
  output ASIST plays, and DeepFilterNet runs inside ASIST.
- **A hook in ASIST that hands out the VAD's input.** It would ship measurement code, and a way to read
  the microphone, in every copy of a public app, for a need only this bench has.
- **A breakpoint on the line where the voice controller feeds its VAD.** Once the microphone has run for a
  few minutes, V8 has optimized that line into its caller and the breakpoint no longer pauses: on
  2026-09-30 the session after a five-minute one waited for it without end, while frames reached the line
  before it a hundred times a second. The button's handler runs only when it is pressed.
- **A conditional breakpoint on every frame.** The debugger would evaluate on ASIST's audio path fifty to
  a hundred times a second; one pause at the start costs nothing afterwards.
- **Reading ASIST's log.** It says how captures ended, but nothing about a voice that never opens one.

## Measured

2026-09-30, ASIST 0.3.1 on an Apple M5 with the built-in microphone, two test sessions: a replay of the
recorded frames with ASIST's values (`segment` in `src/vad.ts`, started from the noise floor ASIST had)
opens and ends the same captures, with the same voiced and confirmed lengths, as ASIST did, on every item.
With the native helper and DeepFilterNet the room reached the VAD at about −142 dBFS and the assistant's
echo at −80 dBFS at its loudest; through getUserMedia the room was at −80 dBFS and the echo at −51 dBFS.
