"""mlx-audio's port of Irodori-TTS behind speech.cpp's worker protocol, so that the bench measures it the way it
measures speech.cpp's port and the official runtime.

usage: worker.py --model FOLDER [--seed n] [--steps n] --voice NAME=FILE ...

FOLDER holds an mlx-community conversion: `config.json`, `model.safetensors`, `dacvae/` and `tokenizer/`. mlx-audio
does not stream Irodori-TTS, so each sentence is sent as one chunk once it is spoken.

Each voice's WAVE file is loaded and encoded once, before `ready`. `Model.generate()` encodes the reference again
for every sentence, which speech.cpp's worker, given a voice file, does not; the adapter keeps the latent of each
waveform it was given and hands it back, so `generate()` runs as released otherwise.
"""

import argparse
import base64
import json
import random
import sys

import mlx.core as mx
import numpy as np
from mlx_audio.tts.utils import load_model

PREFIX = "ASIST_JSON:"


def send(message):
    print(PREFIX + json.dumps(message, ensure_ascii=False), flush=True)


def pcm16(audio):
    """The model's float audio as base64 16-bit little-endian samples, the chunk the protocol carries."""
    samples = np.round(np.clip(np.array(audio, dtype=np.float32), -1, 1) * 32767).astype("<i2")
    return base64.b64encode(samples.tobytes()).decode("ascii")


def encode_each_waveform_once(model):
    """Replaces the model's reference encoding with one that keeps the latent of each waveform object it saw."""
    encode = model._encode_ref_audios
    latents = {}

    def encode_once(audios, max_ref_seconds=None):
        key = (tuple(id(audio) for audio in audios), max_ref_seconds)
        if key not in latents:
            latents[key] = encode(audios, max_ref_seconds=max_ref_seconds)
            mx.eval(*latents[key])
        return latents[key]

    model._encode_ref_audios = encode_once


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--steps", type=int)
    parser.add_argument("--voice", action="append", default=[])
    args = parser.parse_args()

    try:
        model = load_model(args.model)
        encode_each_waveform_once(model)
        # generate() hands an array of shape (1, samples) to the encoder as it is, so the same object, and the
        # latent kept for it, comes back with every request.
        voices = {name: model._load_ref_waveform(path) for name, path in (voice.split("=", 1) for voice in args.voice)}
        for waveform in voices.values():
            model._encode_ref_audios([waveform])
    except Exception as error:
        send({"type": "fatal", "error": str(error)})
        return 1
    send({"type": "ready", "sampleRate": int(model.sample_rate)})

    # As speech.cpp's worker does, the seed given applies to the first request and each later one takes the next;
    # without one, each request draws its own, since mlx-audio samples with seed 0 when given none.
    seed = args.seed
    for line in sys.stdin:
        request = json.loads(line)
        try:
            if request["language"].split("-")[0] != "ja":
                raise ValueError(f"Irodori-TTS speaks Japanese, not {request['language']}")
            if request["voice"] not in voices:
                raise ValueError(f"there is no voice {request['voice']}; the worker was given {', '.join(voices) or 'none'}")
            options = {"rng_seed": random.randrange(2**31) if seed is None else seed}
            if args.steps is not None:
                options["num_steps"] = args.steps
            [result] = list(model.generate(request["text"], ref_audio=voices[request["voice"]], **options))
            seed = None if seed is None else seed + 1
            send({"type": "chunk", "id": request["id"], "pcm": pcm16(result.audio)})
            send({"type": "end", "id": request["id"]})
        except Exception as error:
            send({"type": "error", "id": request.get("id"), "error": str(error)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
