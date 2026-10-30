"""ReazonSpeech's k2 model in its own package, reazonspeech-k2-asr, behind speech.cpp's worker protocol 3, so that the
bench measures it the way it measures the other runtimes.

usage: worker.py --model FOLDER

FOLDER holds reazonspeech-k2-v2's FP32 files as its repository publishes them. The recognizer is sherpa-onnx's, made
with the arguments the package's load_model() gives it by default: the FP32 transducer of the Japanese model, one
thread, greedy search and the CPU, which is the device load_model() takes unless told another. load_model() itself is
not called, since it finds the files by the repository's name in Hugging Face's cache. Each utterance goes through the
package's transcribe(), which pads it with 0.9 s of silence on each side.

A recognition request is its audio in `chunk` messages of base64 16-bit PCM numbered from 0, at 16 kHz, then
`transcribe` with `sample_rate` and, optionally, `language` as a BCP 47 tag, which the model only checks.
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

import numpy as np  # noqa: E402
import sherpa_onnx  # noqa: E402
from reazonspeech.k2.asr import TranscribeConfig, audio_from_numpy, transcribe as k2_transcribe  # noqa: E402

# The options of speech.cpp's vocabulary, of which this adapter takes those in TRANSCRIBE besides `type`, `id` and
# `sample_rate`.
VOCABULARY = {"language", "prompt", "timestamps", "decoding", "max_seconds"}
TRANSCRIBE = {"language"}
SAMPLE_RATE = 16000
LANGUAGES = ["ja"]
# The files load_model() reads for the Japanese model at FP32, whose checkpoint is of epoch 99.
FILES = {"tokens": "tokens.txt", "encoder": "encoder-epoch-99-avg-1.onnx", "decoder": "decoder-epoch-99-avg-1.onnx", "joiner": "joiner-epoch-99-avg-1.onnx"}


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


def load(folder):
    paths = {name: os.path.join(folder, file) for name, file in FILES.items()}
    for path in paths.values():
        if not os.path.isfile(path):
            raise RuntimeError(f"{folder} has no {os.path.basename(path)}")
    return sherpa_onnx.OfflineRecognizer.from_transducer(
        **paths, num_threads=1, sample_rate=SAMPLE_RATE, feature_dim=80, decoding_method="greedy_search", provider="cpu")


def model_info():
    return {
        "architecture": "reazonspeech-k2-v2",
        "task": "recognition",
        "sample_rate": SAMPLE_RATE,
        "languages": LANGUAGES,
        "options": [{"name": "language", "type": "string", "required": False, "steers": False}],
        "device": "cpu",
    }


def check_members(request, taken):
    """Refuses a member the request's type does not have, and an option of the vocabulary the adapter does not take."""
    for name, value in request.items():
        if name in ("type", "id") or name in taken or value is None:
            continue
        if name in VOCABULARY:
            raise RequestError("unsupported", name, f"the ReazonSpeech k2 adapter takes no {name}")
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


def transcribe(model, pieces, request):
    check_members(request, TRANSCRIBE | {"sample_rate"})
    rate = request.get("sample_rate")
    if not (whole(rate) and rate > 0):
        raise RequestError("invalid_argument", "sample_rate", "a recognition needs the sample rate of its chunks")
    tag = request.get("language")
    if tag is not None and (not isinstance(tag, str) or tag.split("-")[0].lower() not in LANGUAGES):
        raise RequestError("out_of_range", "language", f"reazonspeech-k2-v2 does not recognize {tag}; it recognizes Japanese alone")
    if not pieces:
        raise RequestError("invalid_argument", "pcm", "a recognition needs audio")
    samples = np.concatenate(pieces).astype(np.float32) / 32768
    # The package resamples audio at another rate to 16 kHz itself.
    result = k2_transcribe(model, audio_from_numpy(samples, rate), TranscribeConfig(verbose=False))
    send({"type": "end", "id": request["id"], "text": result.text, "stop": "complete"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    args = parser.parse_args()

    try:
        version = json.loads(importlib.metadata.distribution("reazonspeech-k2-asr").read_text("direct_url.json"))["vcs_info"]["commit_id"]
        model = load(args.model)
    except Exception as error:
        traceback.print_exc()
        send({"type": "fatal", "error": {"code": "model_file", "option": None, "message": str(error)}})
        return 1
    send({"type": "ready", "protocol": 3, "version": version, "model": model_info()})

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
                transcribe(model, audio.pop(rid, []), request)
            elif kind == "info":
                check_members(request, set())
                send({"type": "end", "id": rid, "model": model_info()})
            else:
                raise RequestError("unsupported", "type", f"the ReazonSpeech k2 adapter takes no {kind}")
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
