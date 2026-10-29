"""mlx-audio's port of Nemotron 3.5 Transcribe behind speech.cpp's worker protocol 3, so that the bench measures it
the way it measures the other runtimes of the model.

usage: worker.py --model FOLDER --instruction TEXT

FOLDER holds an MLX conversion as mlx-audio's `stt.load()` reads it: `config.json`, the safetensors shards and the
tokenizer. It is loaded with `strict=True`, as the conversion's card loads it, so that a weight the port does not use
or does not find stops the worker.

Every request is transcribed with TEXT as the user's instruction, which mlx-audio writes before the audio as
`TEXT <|audio|>` in the turn of an empty system prompt, with thinking off and greedy decoding at mlx-audio's defaults
(temperature 0 and at most 1024 new tokens). The model is not told the language: a request's `language` is only
checked against the languages the model card lists for transcription.

A recognition request is its audio in `chunk` messages of base64 16-bit PCM numbered from 0, at 16 kHz, then
`transcribe` with `sample_rate` and, optionally, `language` as a BCP 47 tag.
"""

import argparse
import base64
import importlib.metadata
import json
import os
import sys
import traceback

# The protocol keeps the stdout the bench gave; descriptor 1 then writes to stderr, so whatever a package prints
# to stdout while it loads or runs lands in the log instead of between two messages.
PROTOCOL = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)
sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
sys.stdout = sys.stderr

import mlx.core as mx  # noqa: E402
import numpy as np  # noqa: E402
from mlx_audio.stt import load  # noqa: E402

# The options of speech.cpp's vocabulary, of which this adapter takes those in TRANSCRIBE besides `type`, `id` and
# `sample_rate`.
VOCABULARY = {"language", "prompt", "timestamps", "decoding", "max_seconds"}
TRANSCRIBE = {"language"}
MAX_NEW_TOKENS = 1024

# The languages NVIDIA's model card marks for transcription (the language support matrix, revision ef905575), as
# BCP 47 tags. Norwegian is listed without transcription.
LANGUAGES = [
    "cs", "nl", "en", "fr", "de", "hi", "it", "ko", "pl", "pt", "ru", "sk", "es", "bg", "hr", "da", "et", "fi", "hu",
    "ja", "lv", "lt", "ro", "sl", "sv", "th", "tr", "uk", "ar", "bn", "zh", "el", "he", "id", "mt", "mr", "tl", "ta",
    "te", "vi",
]


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


def model_info(model):
    return {
        "architecture": model.config.model_type,
        "task": "recognition",
        "sample_rate": int(model.sample_rate),
        "languages": LANGUAGES,
        "options": [{"name": "language", "type": "string", "required": False, "steers": False}],
        "device": "metal",
    }


def check_members(request, taken):
    """Refuses a member the request's type does not have, and an option of the vocabulary the adapter does not take."""
    for name, value in request.items():
        if name in ("type", "id") or name in taken or value is None:
            continue
        if name in VOCABULARY:
            raise RequestError("unsupported", name, f"the mlx-audio adapter takes no {name}")
        raise RequestError("invalid_argument", name, f"{request['type']} has no member {name}")


def take_chunk(audio, request):
    """Adds a chunk's samples to the audio of its request, which must come in the order they are numbered."""
    check_members(request, {"seq", "pcm"})
    pieces = audio.setdefault(request["id"], [])
    if request.get("seq") != len(pieces):
        raise RequestError("invalid_argument", "seq", f"chunk {request.get('seq')} came where chunk {len(pieces)} was due")
    if not isinstance(request.get("pcm"), str):
        raise RequestError("invalid_argument", "pcm", "a chunk carries base64 16-bit PCM")
    pieces.append(np.frombuffer(base64.b64decode(request["pcm"]), dtype="<i2"))


def transcribe(model, instruction, pieces, request):
    check_members(request, TRANSCRIBE | {"sample_rate"})
    rate = request.get("sample_rate")
    if not (whole(rate) and rate > 0):
        raise RequestError("invalid_argument", "sample_rate", "a recognition needs the sample rate of its chunks")
    # generate() takes an array as audio at the model's rate as it is, without resampling it.
    if rate != model.sample_rate:
        raise RequestError("invalid_argument", "sample_rate", f"the model hears {model.sample_rate} Hz audio, not {rate} Hz")
    tag = request.get("language")
    if tag is not None and (not isinstance(tag, str) or tag.split("-")[0].lower() not in LANGUAGES):
        raise RequestError("out_of_range", "language", f"Nemotron 3.5 Transcribe does not transcribe {tag}; it transcribes {', '.join(LANGUAGES)}")
    if not pieces:
        raise RequestError("invalid_argument", "pcm", "a recognition needs audio")
    samples = np.concatenate(pieces).astype(np.float32) / 32768
    result = model.generate(samples, prompt=instruction, temperature=0.0, max_tokens=MAX_NEW_TOKENS, enable_thinking=False)
    stop = "model_limit" if result.generation_tokens >= MAX_NEW_TOKENS else "complete"
    send({"type": "end", "id": request["id"], "text": result.text, "stop": stop})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--instruction", required=True)
    args = parser.parse_args()

    try:
        version = json.loads(importlib.metadata.distribution("mlx-audio").read_text("direct_url.json"))["vcs_info"]["commit_id"]
        if not mx.metal.is_available():
            raise RuntimeError("MLX finds no Metal device on this machine")
        model = load(args.model, strict=True)
        if model.config.model_type != "nemotron_transcribe":
            raise RuntimeError(f"{args.model} is a {model.config.model_type} model; the adapter runs Nemotron 3.5 Transcribe")
    except Exception as error:
        traceback.print_exc()
        send({"type": "fatal", "error": {"code": "model_file", "option": None, "message": str(error)}})
        return 1
    send({"type": "ready", "protocol": 3, "version": version, "model": model_info(model)})

    # The audio of each request whose transcribe has not come, and the requests refused before it came, whose later
    # lines are passed over until then.
    audio, refused = {}, set()
    # The lines are read as bytes, which json.loads() decodes as UTF-8, the protocol's encoding.
    for line in sys.stdin.buffer:
        try:
            request = json.loads(line)
        except ValueError:
            request = None
        if not isinstance(request, dict) or not isinstance(request.get("id"), str) or not request["id"]:
            send({"type": "error", "error": {"code": "invalid_argument", "option": "id", "message": "a line must be a JSON object with a non-empty string id"}})
            continue
        kind, rid = request.get("type"), request["id"]
        if rid in refused:
            if kind == "transcribe":
                refused.discard(rid)
            continue
        if kind == "cancel":
            if set(request) != {"type", "id"}:
                send({"type": "error", "error": {"code": "invalid_argument", "option": "type", "message": "a cancel has an id and nothing more"}})
            continue
        try:
            if kind == "chunk":
                take_chunk(audio, request)
            elif kind == "transcribe":
                transcribe(model, args.instruction, audio.pop(rid, []), request)
            elif kind == "info":
                check_members(request, set())
                send({"type": "end", "id": rid, "model": model_info(model)})
            else:
                raise RequestError("unsupported", "type", f"the mlx-audio adapter takes no {kind}")
        except Exception as error:
            if not isinstance(error, RequestError):
                traceback.print_exc()
            if kind == "chunk":
                audio.pop(rid, None)
                refused.add(rid)
            failure = error.error if isinstance(error, RequestError) else {"code": "internal", "option": None, "message": str(error)}
            send({"type": "error", "id": rid, "error": failure})
    return 0


if __name__ == "__main__":
    sys.exit(main())
