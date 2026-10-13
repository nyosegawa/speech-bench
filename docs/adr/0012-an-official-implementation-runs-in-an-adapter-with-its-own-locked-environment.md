# An official implementation runs in an adapter with its own locked environment

A model's official implementation is measured through an adapter in `adapters/<id>/`: a Python project that
speaks speech.cpp's worker protocol (docs/adr/0008), with the implementation pinned to a commit or a release and every
package pinned with its hash by uv's lock file. The bench downloads and verifies the weights as it does every
model file, by repository, revision, size and sha256, and gives the adapter their paths; the adapter runs with
Hugging Face's libraries offline, so that a file the implementation would fetch by name stops it. uv installs the
packages into `adapters/<id>/` of the data folder before the worker starts, so that installing is not timed as
loading. The commit or release the project pins is the runtime's version in a result.

An official implementation in PyTorch runs on the GPU of the machine: Metal through MPS on a Mac, CUDA on Windows.
PyPI's PyTorch for Windows runs on the CPU alone, so each project takes `torch` and `torchaudio` for Windows from
PyTorch's own CUDA 12.8 index through uv's sources, and the lock file pins those wheels by hash beside PyPI's for the
Mac; nothing is installed outside the environment. An adapter refuses to start, with `fatal`, when PyTorch finds no
such device or has no kernels for the GPU, rather than run on the CPU. Each implementation runs in the precision its
own code uses by default on CUDA, and the result records the device and the precision with the runtime's options:
Irodori-TTS at FP32, the default of its runtime, and Qwen3-TTS and Qwen3-ASR in BF16, the dtype of their checkpoints
and of their examples and command lines. An RTX 2080 has no BF16 in its tensor cores, which makes the Qwen models
slower there than FP16 would be; FP16 is not what Qwen runs, and the bench measures the implementation as released.
Where the implementation asks for FlashAttention 2, which runs on neither an Apple GPU nor an RTX 2080, it runs with
PyTorch's own attention, as it does whenever FlashAttention 2 is not installed.

Irodori-TTS's adapter runs v4.1 Small as released, with the runtime's own sampler settings, and leaves
SilentCipher's watermark out as speech.cpp's port does, so that the two make speech from the same model in the same
way. The runtime does not stream: a sentence comes back whole, and its first audio is its last.

The adapter encodes each reference voice once, before `ready`, the way the runtime encodes a `ref_wav`, and
gives every request the latent as a `ref_latent`. Given the WAVE file, the runtime encodes it again for every
sentence: on an Apple M5 that took 0.9 to 1.0 s of a 2.1 s sentence with MF, which speech.cpp's worker, given a
voice file, never spends. The speech is the same sample for sample (2026-10-05).

Qwen3-TTS's adapter runs the CustomVoice checkpoints through `generate_custom_voice()` of `qwen-tts` at the commit
speech.cpp's reference pins, from the revisions speech.cpp converts, sampled with the checkpoint's
`generate_config.json`. The run's seed goes to `torch.manual_seed()` before each sentence. It does not stream either.

## Rejected

- **torch.compile, which Irodori-TTS's runtime offers.** On an Apple M5 through MPS (PyTorch 2.10.0, 2026-10-05) it
  compiled again for each new length of speech, 14 s each, and the sampler took 0.7 to 0.9 s a sentence
  against 0.4 to 0.6 s without it.
- **Irodori-TTS's codec on the CPU, the runtime's default.** On the M5 it decoded a sentence in 1.9 to 4.0 s against
  1.3 to 1.4 s on MPS.
- **Letting the implementation download its weights.** It would fetch them by repository name into its own
  cache, unverified, and a result could not say which files it measured.
- **Running speech.cpp's reference scripts.** They belong to the port's repository and change with it; the
  bench pins what it measures.
- **PyTorch from PyPI on Windows.** It runs on the CPU there, which no other runtime of the bench does on that
  machine, and which the official code does not intend.
- **A CUDA PyTorch installed on the system, or a lock file of its own for Windows.** The one lock file pins both
  machines' wheels, and the adapter's environment holds everything it runs.
- **FP16 on the RTX 2080.** It would be faster there, but the Qwen models are released and run in BF16, and FP16
  would measure a precision neither Qwen's code nor the Mac runs.

## Measured

2026-10-13, Apple M5 through MPS in BF16, five Japanese sentences of ono_anna from seed 1: Qwen3-TTS 0.6B spoke at a
real-time factor of 2.7 and 1.7B of 2.5, each sentence whole after 7 to 19 s. BF16 and FP32 took about as long there.
