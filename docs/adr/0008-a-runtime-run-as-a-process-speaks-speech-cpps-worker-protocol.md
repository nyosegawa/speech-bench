# A runtime run as a process speaks speech.cpp's worker protocol

A synthesis runtime that runs as a process of its own is reached through one protocol: speech.cpp's worker
protocol, JSON Lines on stdin and stdout with nothing else on stdout (speech.cpp v0.4.0 on). A request
names `id`, `text`, `voice` and `language` as a BCP 47 tag; the worker answers `ready` once, then `chunk`
messages of base64 16-bit PCM and `end` for each request, `error` for a request that failed and `fatal` for a
worker that could not start. One engine, `WorkerTts`, speaks it. speech.cpp's `speech-worker` speaks it
natively; a runtime that does not, such as a model's official Python implementation, gets a small adapter
that does. A runtime that is a server of its own (llama-server, CrispASR, audio.cpp) keeps an engine written
for its HTTP API.

A model is measured first in what it was released with and later in speech.cpp. When both go through one
protocol, the time to the first audio and the streaming are measured the same way before and after the port,
and a new runtime costs an adapter in its own language rather than an engine in the bench.

## Rejected

- **An engine in TypeScript for each runtime.** Each new model's official implementation would need code in
  the bench that drives Python, and the port and the original would be timed through different code.
- **A protocol of the bench's own.** speech.cpp's worker protocol is already what the ported models speak,
  and what an application runs them with.
- **Keeping qwen3-tts-ggml v0.1.1 beside speech.cpp.** speech.cpp v0.3.0 runs the same Qwen3-TTS, gives the
  same PCM for the same request and seed, and names languages by BCP 47 tags; the older worker reads only
  the GGUFs without those tags.

## Measured

2026-10-01, Apple M5, speech.cpp v0.3.0: Qwen3-TTS 0.6B Q8_0 reached its first audio in 0.039 s at the
median and Irodori-TTS v4.1 Small MF F16 in 0.20 s, speaking like a reference voice given as a voice file
made on the CPU (35 to 50 KB).
