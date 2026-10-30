"""Two Japanese models of NVIDIA NeMo as their official code runs them, behind speech.cpp's worker protocol 3, so that
the bench measures the originals the way it measures their ports.

usage: worker.py --model FILE --family reazonspeech|parakeet --device mps|cuda

FILE is the model's .nemo file as its Hugging Face repository publishes it, restored with NeMo's restore_from(), which
is what from_pretrained() runs on the file it downloads by the repository's name.

`reazonspeech` is reazon-research/reazonspeech-nemo-v2 as reazonspeech-nemo-asr runs it: the model that its
load_model() loads, given to its transcribe(), which pads the audio with 0.5 s of silence on each side, has NeMo decode
it with the file's decoding, ALSD beam search of width 4, and reads the text from the best hypothesis.

`parakeet` is nvidia/parakeet-tdt_ctc-0.6b-ja as its model card runs it: NeMo's transcribe() of one utterance with the
model's default decoder, TDT, decoded greedily as the file says.

Both run in FP32, the dtype of the files, in which NeMo's transcribe() computes. A recognition request is its audio in
`chunk` messages of base64 16-bit PCM numbered from 0, then `transcribe` with `sample_rate` and, optionally,
`language` as a BCP 47 tag, which is only checked: both models transcribe Japanese alone.
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
# The log is UTF-8 whatever the locale.
sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
sys.stdout = sys.stderr

import numpy as np  # noqa: E402
import torch  # noqa: E402
from nemo.collections.asr.models import ASRModel, EncDecHybridRNNTCTCBPEModel, EncDecRNNTBPEModel  # noqa: E402
from nemo.utils import logging  # noqa: E402
from reazonspeech.nemo.asr import audio_from_numpy  # noqa: E402
from reazonspeech.nemo.asr import transcribe as reazonspeech_transcribe  # noqa: E402

# The options of speech.cpp's vocabulary, of which this adapter takes those in TRANSCRIBE besides `type`, `id` and
# `sample_rate`.
VOCABULARY = {"language", "prompt", "timestamps", "decoding", "max_seconds"}
TRANSCRIBE = {"language"}
LANGUAGES = ["ja"]
SAMPLE_RATE = 16000


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


def check_device(device):
    """Refuses a device PyTorch cannot run on here, rather than letting it fall back to the CPU."""
    if device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("PyTorch finds no Metal device (MPS) on this machine")
    if device == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError(f"PyTorch {torch.__version__} finds no CUDA device; install the NVIDIA driver, or check that uv installed PyTorch's CUDA build")
        major, minor = torch.cuda.get_device_capability()
        if f"sm_{major}{minor}" not in torch.cuda.get_arch_list():
            raise RuntimeError(f"PyTorch {torch.__version__} has no kernels for {torch.cuda.get_device_name()} (sm_{major}{minor}); it has {', '.join(torch.cuda.get_arch_list())}")
    if device not in ("mps", "cuda"):
        raise RuntimeError(f"the adapter runs on a GPU, mps or cuda, not {device}")


def restore(cls, path, device):
    """The model of a .nemo file, which must be of class `cls` itself: restore_from() makes the class the file's
    configuration names, which may be a subclass of the one it is called on."""
    model = cls.restore_from(path, map_location=torch.device(device))
    if type(model) is not cls:
        raise RuntimeError(f"{path} holds a model of class {type(model).__name__}, not {cls.__name__}; give the --family of the file")
    return model


class ReazonSpeech:
    """reazon-research/reazonspeech-nemo-v2 as reazonspeech-nemo-asr's load_model() and transcribe() run it."""

    def __init__(self, path, device):
        # load_model() quiets NeMo's logging the same way before it loads the model.
        logging.setLevel(logging.ERROR)
        self.model = restore(EncDecRNNTBPEModel, path, device)

    def transcribe(self, samples, rate):
        # transcribe() brings the audio to 16 kHz itself, with librosa.
        return reazonspeech_transcribe(self.model, audio_from_numpy(samples, rate)).text


class Parakeet:
    """nvidia/parakeet-tdt_ctc-0.6b-ja as its model card runs it, given the audio as an array rather than a WAVE file's
    path. NeMo reads an array without the worker process its dataloader of files starts for each call, and pads one
    shorter than 1 s to 1 s with silence on both sides, which it does not do to a file."""

    def __init__(self, path, device):
        self.model = restore(EncDecHybridRNNTCTCBPEModel, path, device)

    def transcribe(self, samples, rate):
        # NeMo takes an array as audio at the model's rate, without resampling it.
        if rate != SAMPLE_RATE:
            raise RequestError("invalid_argument", "sample_rate", f"the model hears {SAMPLE_RATE} Hz audio, not {rate} Hz")
        [hypothesis] = self.model.transcribe([samples])
        return hypothesis.text


FAMILIES = {"reazonspeech": ReazonSpeech, "parakeet": Parakeet}


def model_info(recognizer, device):
    return {
        "architecture": type(recognizer.model).__name__,
        "task": "recognition",
        "sample_rate": SAMPLE_RATE,
        "languages": LANGUAGES,
        "options": [{"name": "language", "type": "string", "required": False, "steers": False}],
        "device": device,
    }


def check_members(request, taken):
    """Refuses a member the request's type does not have, and an option of the vocabulary the adapter does not take."""
    for name, value in request.items():
        if name in ("type", "id") or name in taken or value is None:
            continue
        if name in VOCABULARY:
            raise RequestError("unsupported", name, f"the NeMo adapter takes no {name}")
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


def transcribe(recognizer, pieces, request):
    check_members(request, TRANSCRIBE | {"sample_rate"})
    rate = request.get("sample_rate")
    if not (whole(rate) and rate > 0):
        raise RequestError("invalid_argument", "sample_rate", "a recognition needs the sample rate of its chunks")
    tag = request.get("language")
    if tag is not None and (not isinstance(tag, str) or tag.split("-")[0].lower() not in LANGUAGES):
        raise RequestError("out_of_range", "language", f"the model does not transcribe {tag}; it transcribes {', '.join(LANGUAGES)}")
    if not pieces:
        raise RequestError("invalid_argument", "pcm", "a recognition needs audio")
    samples = np.concatenate(pieces).astype(np.float32) / 32768
    # A transducer's decoding ends with the encoder's frames rather than at a number of tokens; ALSD allows as many
    # tokens as frames, one for each 80 ms, which speech does not reach.
    send({"type": "end", "id": request["id"], "text": recognizer.transcribe(samples, rate), "stop": "complete"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--family", required=True, choices=list(FAMILIES))
    parser.add_argument("--device", required=True)
    args = parser.parse_args()

    try:
        version = importlib.metadata.version("nemo_toolkit")
        check_device(args.device)
        recognizer = FAMILIES[args.family](args.model, args.device)
    except Exception as error:
        traceback.print_exc()
        send({"type": "fatal", "error": {"code": "model_file", "option": None, "message": str(error)}})
        return 1
    send({"type": "ready", "protocol": 3, "version": version, "model": model_info(recognizer, args.device)})

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
                transcribe(recognizer, audio.pop(rid, []), request)
            elif kind == "info":
                check_members(request, set())
                send({"type": "end", "id": rid, "model": model_info(recognizer, args.device)})
            else:
                raise RequestError("unsupported", "type", f"the NeMo adapter takes no {kind}")
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
