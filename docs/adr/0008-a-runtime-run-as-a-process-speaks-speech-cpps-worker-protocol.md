# A runtime run as a process speaks speech.cpp's worker protocol

A runtime that runs as a process of its own, for synthesis or for recognition, is reached through one protocol:
speech.cpp's worker protocol 3 (speech.cpp v0.8.0 on), JSON Lines on stdin and stdout with nothing else on stdout. The
worker answers `ready` once, with the protocol's version and the model's information, or `fatal` when it cannot start.
A synthesis request is `synthesize` with `id`, `text`, `voice`, `language` as a BCP 47 tag and the run's options as
members: `seed`, the run's seed for the first request and the next one for each later request, and `steps` when the
run sets them. The worker answers it with `chunk` messages of base64 16-bit PCM numbered from 0, `progress` while it
passes no audio, and exactly one terminal message: `end` with the seed and the number of samples it sent, `error` with
a code, the option at fault and a message, or `cancelled`. A recognition request is the utterance's audio in `chunk`
messages of base64 16-bit PCM numbered from 0, at the rate the bench has it, then `transcribe` with that `sample_rate`
and `language`, the set's locale without its region. The worker answers it with `progress` and exactly one terminal
message: `end` with the text and its stop, `error` or `cancelled`. Two engines, `WorkerTts` and `WorkerAsr`, speak it
over one process of the bench's, `WorkerProcess`. speech.cpp's `speech worker` speaks it natively; a runtime that does
not, such as a model's official Python implementation, gets a small adapter that does. A runtime that is a server of
its own (llama-server, CrispASR, audio.cpp) keeps an engine written for its HTTP API.

A model is measured first in what it was released with and later in speech.cpp. When both go through one
protocol, the time to the first audio and the streaming are measured the same way before and after the port,
and a new runtime costs an adapter in its own language rather than an engine in the bench. The first audio is
the first chunk read after the request is written; `progress` is not audio. `speech worker` starts with
`--no-warmup`, so that the load time is the loading alone, as for every other runtime, and the run's first
sentence or utterance, run once untimed, pays for the GPU's first use.

A recognition is timed from writing its first chunk, once its lines are made, to reading its `end`, as llama-server
and CrispASR are timed from sending a request whose body already holds the utterance's WAVE file: the utterance is
sent whole once it has ended, and the chunks carry the samples that WAVE file holds. The `language` goes to every
model. It steers Qwen3-ASR, which writes it into its prompt as the start of the answer, `language Japanese<asr_text>`,
the same start the llama-server engine gives its answer, so that the two runtimes are compared on the same request.
FastConformer only checks it against the model's languages, so parakeet-tdt-0.6b-v3 still finds the language itself,
as in CrispASR, where the bench sends none. The `language` option of the model's information says whether it steers,
and a model whose file says otherwise than the catalog's `languageHint` stops the run before it is measured. An `end`
whose stop is `model_limit` holds the text up to the most tokens the model writes (Qwen3-ASR's 4096) and is kept as
the model's text, as llama-server's text at its `max_tokens` is.

The seeds follow the rule the runs of speech.cpp and of the adapters were recorded under before protocol 2, when
speech.cpp's worker took the run's seed on its command line and gave each later request the next one, so that the
seed a result records means the same in every run of these runtimes.

A worker of another protocol is refused, and a line that breaks the protocol is the worker's defect and fails
the run: a line that is not a JSON object, an answer without the id of a request, a message for a request that
has had its terminal message or was never sent, a chunk out of its order, an `end` of a synthesis whose samples or
seed are not what was sent, a `chunk` for a recognition, an `end` of a
recognition without a text or with a stop a recognition does not have, and a `cancelled` the bench did not ask for.
A type of message the bench does not know is passed over, since protocol 3 may gain messages without being raised.

## Rejected

- **An engine in TypeScript for each runtime.** Each new model's official implementation would need code in
  the bench that drives Python, and the port and the original would be timed through different code.
- **A protocol of the bench's own.** speech.cpp's worker protocol is already what the ported models speak,
  and what an application runs them with.
- **Skipping a line the bench cannot place.** A worker that answers a request the bench is not waiting for has
  lost track of its requests, and a run that went on would time and keep speech it cannot vouch for.
- **Keeping qwen3-tts-ggml v0.1.1 beside speech.cpp.** speech.cpp v0.3.0 runs the same Qwen3-TTS, gives the
  same PCM for the same request and seed, and names languages by BCP 47 tags; the older worker reads only
  the GGUFs without those tags.
- **speech.cpp's HTTP server for recognition, as llama-server and CrispASR are reached.** `speech serve` takes the
  same audio, but its recognition would be timed through other code than its synthesis, while the worker is how the
  bench already runs speech.cpp and how an application runs it.

## Measured

2026-10-01, Apple M5, speech.cpp v0.3.0: Qwen3-TTS 0.6B Q8_0 reached its first audio in 0.039 s at the
median and Irodori-TTS v4.1 Small MF F16 in 0.20 s, speaking like a reference voice given as a voice file
made on the CPU (35 to 50 KB).
