"""mlx-audio's port of Irodori-TTS behind speech.cpp's worker protocol 2, so that the bench measures it the way it
measures speech.cpp's port and the official runtime.

usage: worker.py --model FOLDER [--add-voice NAME=FILE]...

FOLDER holds an mlx-community conversion: `config.json`, `model.safetensors`, `dacvae/` and `tokenizer/`. mlx-audio
does not stream Irodori-TTS, so each sentence is sent as one chunk once it is spoken.

A request takes `voice`, `language` (`ja`, a region of it or `auto`), `seed` and `steps`, as speech.cpp's Irodori-TTS
does. Each voice's WAVE file is loaded and encoded once, when it is added. `Model.generate()` encodes the reference
again for every sentence, which speech.cpp's worker, given a voice file, does not; the adapter keeps the latent of
each waveform it was given and hands it back, so `generate()` runs as released otherwise.
"""

import argparse
import base64
import importlib.metadata
import json
import os
import random
import sys

# The protocol keeps the stdout the bench gave; descriptor 1 then writes to stderr, so whatever a package prints
# to stdout while it loads or runs lands in the log instead of between two messages.
PROTOCOL = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)
sys.stdout = sys.stderr

import mlx.core as mx  # noqa: E402
import numpy as np  # noqa: E402
from mlx_audio.tts.utils import load_model  # noqa: E402

# The options of speech.cpp's vocabulary, of which this adapter takes those in SYNTHESIZE besides `type`, `id` and `text`.
VOCABULARY = {"voice", "language", "seed", "speed", "seconds", "duration_scale", "steps", "max_seconds", "timestamps", "prompt"}
SYNTHESIZE = {"voice", "language", "seed", "steps"}
MAX_SEED = 2**53 - 1


class RequestError(Exception):
    """A request refused as speech.cpp's worker refuses one: the library's code, the input at fault and why."""

    def __init__(self, code, option, message):
        super().__init__(message)
        self.error = {"code": code, "option": option, "message": message}


def send(message):
    print(json.dumps(message, ensure_ascii=False), file=PROTOCOL, flush=True)


def whole(value):
    """Whether a JSON value is an integer; Python reads `true` as one."""
    return isinstance(value, int) and not isinstance(value, bool)


def pcm16(audio):
    """The model's float audio as base64 16-bit little-endian samples, the chunk the protocol carries."""
    samples = np.round(np.clip(np.array(audio, dtype=np.float32), -1, 1) * 32767).astype("<i2")
    return base64.b64encode(samples.tobytes()).decode("ascii"), samples.size


def check_members(request, taken):
    """Refuses a member the request's type does not have, and an option of the vocabulary the adapter does not take."""
    for name, value in request.items():
        if name in ("type", "id") or name in taken or value is None:
            continue
        if name in VOCABULARY:
            raise RequestError("unsupported", name, f"the mlx-audio adapter takes no {name}")
        raise RequestError("invalid_argument", name, f"{request['type']} has no member {name}")


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


def load_voice(model, path):
    """A voice's waveform, encoded once. generate() hands an array of shape (1, samples) to the encoder as it is, so
    the same object, and the latent kept for it, comes back with every request."""
    waveform = model._load_ref_waveform(path)
    model._encode_ref_audios([waveform])
    return waveform


def model_info(model, voices):
    return {
        "architecture": "irodori-tts",
        "task": "synthesis",
        "sample_rate": int(model.sample_rate),
        "incremental": False,
        "languages": ["ja"],
        "voices": [{"name": name, "language": "", "gender": "", "description": ""} for name in voices],
        "device": "metal",
    }


def synthesize(model, voices, request):
    check_members(request, SYNTHESIZE | {"text"})
    text, voice, language = request.get("text"), request.get("voice"), request.get("language") or "auto"
    if not isinstance(text, str) or not text:
        raise RequestError("invalid_argument", "text", "a synthesis needs a text")
    if voice is None:
        raise RequestError("invalid_argument", "voice", "Irodori-TTS needs a voice")
    if voice not in voices:
        raise RequestError("out_of_range", "voice", f"there is no voice {voice}; the voices are {', '.join(voices) or 'none'}")
    if not isinstance(language, str) or (language.lower() != "auto" and language.split("-")[0].lower() != "ja"):
        raise RequestError("out_of_range", "language", f"Irodori-TTS speaks ja, not {language}")
    seed = request.get("seed")
    if seed is not None and not (whole(seed) and 0 <= seed <= MAX_SEED):
        raise RequestError("out_of_range", "seed", f"a seed is a whole number from 0 to {MAX_SEED}")
    steps = request.get("steps")
    if steps is not None and not (whole(steps) and steps >= 1):
        raise RequestError("out_of_range", "steps", "the steps are a whole number from 1")
    # mlx-audio samples with seed 0 when given none, so a request without one draws its own here.
    if seed is None:
        seed = random.randrange(MAX_SEED + 1)
    options = {"rng_seed": seed} | ({} if steps is None else {"num_steps": steps})
    [result] = list(model.generate(text, ref_audio=voices[voice], **options))
    pcm, samples = pcm16(result.audio)
    send({"type": "chunk", "id": request["id"], "seq": 0, "pcm": pcm})
    send({"type": "end", "id": request["id"], "seed": seed, "samples": samples, "stop": "complete"})


def add_voice(model, voices, request):
    check_members(request, {"name", "path"})
    name, path = request.get("name"), request.get("path")
    if not isinstance(name, str) or not name:
        raise RequestError("invalid_argument", "name", "a voice needs a name")
    if not isinstance(path, str) or not path:
        raise RequestError("invalid_argument", "path", "a voice needs the path of a WAVE file")
    try:
        voices[name] = load_voice(model, path)
    except Exception as error:
        raise RequestError("io", "path", f"{path}: {error}") from error
    send({"type": "end", "id": request["id"]})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--add-voice", action="append", default=[])
    args = parser.parse_args()

    try:
        version = json.loads(importlib.metadata.distribution("mlx-audio").read_text("direct_url.json"))["vcs_info"]["commit_id"]
        model = load_model(args.model)
        encode_each_waveform_once(model)
        voices = {name: load_voice(model, path) for name, path in (voice.split("=", 1) for voice in args.add_voice)}
    except Exception as error:
        send({"type": "fatal", "error": {"code": "model_file", "option": None, "message": str(error)}})
        return 1
    send({"type": "ready", "protocol": 2, "version": version, "model": model_info(model, voices)})

    # Each request is answered before the next line is read, so no request is in flight when a line arrives: a
    # cancel names one that has had its answer, and an id is never one in flight.
    for line in sys.stdin:
        try:
            request = json.loads(line)
        except ValueError:
            request = None
        if not isinstance(request, dict) or not isinstance(request.get("id"), str) or not request["id"]:
            send({"type": "error", "error": {"code": "invalid_argument", "option": "id", "message": "a line must be a JSON object with a non-empty string id"}})
            continue
        kind = request.get("type")
        if kind == "cancel":
            if set(request) != {"type", "id"}:
                send({"type": "error", "error": {"code": "invalid_argument", "option": "type", "message": "a cancel has an id and nothing more"}})
            continue
        try:
            if kind == "synthesize":
                synthesize(model, voices, request)
            elif kind == "add_voice":
                add_voice(model, voices, request)
            elif kind == "info":
                check_members(request, set())
                send({"type": "end", "id": request["id"], "model": model_info(model, voices)})
            else:
                raise RequestError("unsupported", "type", f"the mlx-audio adapter takes no {kind}")
        except RequestError as error:
            send({"type": "error", "id": request["id"], "error": error.error})
        except Exception as error:
            send({"type": "error", "id": request["id"], "error": {"code": "internal", "option": None, "message": str(error)}})
    return 0


if __name__ == "__main__":
    sys.exit(main())
