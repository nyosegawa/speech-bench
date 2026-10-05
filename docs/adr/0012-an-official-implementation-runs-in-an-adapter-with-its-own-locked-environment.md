# An official implementation runs in an adapter with its own locked environment

A model's official implementation is measured through an adapter in `adapters/<id>/`: a Python project that
speaks speech.cpp's worker protocol (docs/adr/0008), with the implementation pinned to a commit and every
package pinned with its hash by uv's lock file. The bench downloads and verifies the weights as it does every
model file, by repository, revision, size and sha256, and gives the adapter their paths; uv installs the
packages into `adapters/<id>/` of the data folder before the worker starts, so that installing is not timed as
loading. The commit the project pins is the runtime's version in a result.

Irodori-TTS's adapter runs v4.1 Small at FP32, as released, on the Mac's GPU through PyTorch's MPS backend,
with the runtime's own sampler settings, and leaves SilentCipher's watermark out as speech.cpp's port does, so
that the two make speech from the same model in the same way. The runtime does not stream: a sentence comes
back whole, and its first audio is its last.

The adapter encodes each reference voice once, before `ready`, the way the runtime encodes a `ref_wav`, and
gives every request the latent as a `ref_latent`. Given the WAVE file, the runtime encodes it again for every
sentence: on an Apple M5 that took 0.9 to 1.0 s of a 2.1 s sentence with MF, which speech.cpp's worker, given a
voice file, never spends. The speech is the same sample for sample (2026-10-05).

## Rejected

- **torch.compile, which the runtime offers.** On an Apple M5 through MPS (PyTorch 2.10.0, 2026-10-05) it
  compiled again for each new length of speech, 14 s each, and the sampler took 0.7 to 0.9 s a sentence
  against 0.4 to 0.6 s without it.
- **The codec on the CPU, the runtime's default.** On the M5 it decoded a sentence in 1.9 to 4.0 s against
  1.3 to 1.4 s on MPS.
- **Letting the implementation download its weights.** It would fetch them by repository name into its own
  cache, unverified, and a result could not say which files it measured.
- **Running speech.cpp's reference scripts.** They belong to the port's repository and change with it; the
  bench pins what it measures.
- **The adapter on Windows.** PyTorch from PyPI runs on the CPU there; a CUDA build is another set of
  packages, which the lock file does not install.
