# NeMo-Speech.cpp's speech-LLM runs from a build of a pinned commit, on a file its converter makes

NeMo-Speech.cpp runs Nemotron 3.5 Transcribe, a speech-LLM (SALM), from commit 66d50d91, which fixed the SALM
transcription that commit 6a625011 added. No release has it: v0.2.0 is the latest, and the `nightly` prerelease is
deleted and published again from main whenever main moves, so an archive of it pinned by URL and sha256 stops
downloading within days. The bench builds the commit itself, as the release workflow builds the macOS Metal archive:
Git fetches the repository at the commit with the `llama.cpp` and `cpp-httplib` submodules at the commits it pins, the
repository's script builds SentencePiece statically at the commit it pins, and the `metal-server` preset configures the
build with `GGML_NATIVE=OFF` and without gRPC, with the CMake and Ninja that `builders/nemo-speech.cpp/uv.lock` pins and
the system's compilers (the Xcode Command Line Tools). The archive also carries text normalization, which the bench
never asks for and leaves out. `cmake --install` puts the build in `runtimes/nemo-speech.cpp-66d50d91b75a`, whose
libraries load relative to the executable, and the checkout and the build are removed. A result records the release
number the build prints, 0.2.0, and the commit as a local build. It builds on a Mac alone; the bench builds nothing on
Windows, whose machine has no compiler.

The model file is converted from NVIDIA's checkpoint (nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B at ef905575) by
the repository's `convert_model.py` at the same commit, as the FastConformer models are at v0.2.0 (docs/adr/0021):
`--architecture salm --outtype iq4_nl`, the routed experts in IQ4_NL and the dense linears in Q8_0, which
NeMo-Speech.cpp's guide gives Metal, Vulkan and any GPU without NVFP4. The conversion writes two files, the decoder and
beside it the encoder file it names, the speech and speaker encoders in F16 and the CTC timestamp head, and the catalog
pins both; they are kept in one folder, named by the decoder's sha256, from which the server loads the encoder, and a
result records the sha256 of each. The converter reads the checkpoint as a folder and writes the folder's name into
both files and into the name of the encoder's, so the bench gives it a folder named as the repository, of hard links to
the checkpoint's files in the store. It writes the decoder in BF16 first, about 66 GB beside the output, and then
quantizes it with llama.cpp's `llama-quantize`, which it builds from its `llama.cpp` submodule with the CMake and Ninja
of `converters/nemo-speech.cpp/uv.lock`.

The server is asked as a user of its chat completions asks it: `POST /v1/chat/completions` with the utterance whole and
an instruction of docs/adr/0034, decoded greedily. It is started with one decode slot, `asr.salm.max_sequences=1`,
and a pool of 73,728 tokens for it, `asr.salm.n_ctx_per_sequence=73728`, the longest request the engine takes by
default. By default it decodes 16 requests at once, and on every path but CUDA's batched one it reserves each slot's
recurrent state, about 48 MiB, and its 8,192 tokens of KV cache when it starts; the bench sends one request at a time,
and the memory a run records would otherwise be that of 16 callers. The result records both settings. On Metal the
server runs upstream llama.cpp's kernels and no speculative decoding, whatever `asr.salm.mtp_draft` says.

## Rejected

- **The nightly archive, pinned by URL and sha256.** The release workflow deletes the prerelease and publishes it again
  from main each night main has moved; the archive of 66d50d91 is gone once one more commit lands.
- **The archive of a run of the release workflow, by its run id.** GitHub keeps the artifacts of a run for 90 days at
  most, and reading them needs a GitHub login.
- **AtomicChat's GGUF files of the model** (AtomicChat/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B-GGUF). Their `AD-IQ4_NL`
  decoder quantizes the experts with an importance matrix from text and the embeddings and the output head to Q8_0,
  which NVIDIA's converter leaves BF16: another recipe than the runtime's own, which no one could make again from the
  checkpoint with NeMo-Speech.cpp alone.
- **NVFP4, the converter's default.** Only Blackwell GPUs compute it natively; NeMo-Speech.cpp's guide gives IQ4_NL for
  Metal.
- **`/v1/audio/transcriptions`.** It takes no instruction: the server writes its own, adds "The speech is in
  <language>." when it is given a language, and transcribes an empty answer once more with another instruction, which
  it never does with an instruction it was given.
- **The engine's 16 decode slots.** They hold memory for callers the bench never has.

## Measured

2026-10-29, Apple M5 with 32 GB:

- The build took about 2 minutes with 6 jobs, and its installed tree is 20 MB.
- The conversion took 16 minutes, the quantizer's build included. Beside the 67.5 GB checkpoint it wrote the BF16
  decoder, 65.8 GB, the IQ4_NL decoder, 20,352,806,816 bytes, and the encoder file, 1,670,410,080 bytes, so it needed
  about 88 GB of free disk at its peak. Run beside another program's conversion, it filled the disk.
- The encoder file has the size of AtomicChat's, made on Linux at 6a625011, and other bytes (`ebcede89…` against
  `4221029c…`), as the FastConformer files differ between an M5 and an Intel machine (docs/adr/0021).

## Known limits

- At 66d50d91 the server ends a request whose audio its speaker branch hears no one in with an empty transcript, without
  decoding it. On utterances trimmed to the voice (docs/adr/0001) it did so for 17 of 99 Common Voice clips of clear
  speech, 3.9 to 5.1 s long, and for none of FLEURS's; a run counts them as empty, as the runtime answers them, and no
  setting turns it off.
- A conversion needs about 90 GB free beside the checkpoint for a quarter of an hour; the catalog says so, and the
  bench refuses to start one on a disk with less free, so that it never fills a disk another program writes to. The
  files are pinned and kept, so a run never converts them again; on a machine without that room, AtomicChat's files
  run in the same build, as another recipe.
- A build made on another Mac, or with another release of the Xcode Command Line Tools, is not the same bytes; the
  result names the commit, not the binary.
