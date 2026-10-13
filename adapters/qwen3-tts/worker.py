"""Qwen3-TTS's official PyTorch implementation behind speech.cpp's worker protocol 3, so that the bench measures the
original the way it measures the port.

usage: worker.py --model FOLDER --device mps|cuda

FOLDER holds a CustomVoice checkpoint as Qwen publishes it, its codec in `speech_tokenizer/`. The model and its codec
run in bfloat16, the dtype of the checkpoint and of the implementation's examples and command line, with PyTorch's
own attention: FlashAttention 2, which the examples ask for, runs on neither an Apple GPU nor an RTX 2080.
generate_custom_voice() samples with the checkpoint's generate_config.json and does not stream, so each sentence is
sent as one chunk once it is spoken.

A request takes `voice`, one of the checkpoint's speakers, `language` as a BCP 47 tag or `auto`, and `seed`, which
seeds PyTorch's generators before the sentence is sampled.
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

import numpy as np  # noqa: E402
import torch  # noqa: E402
from qwen_tts import Qwen3TTSModel  # noqa: E402

# The options of speech.cpp's vocabulary, of which this adapter takes those in SYNTHESIZE besides `type`, `id` and `text`.
VOCABULARY = {"voice", "language", "seed", "speed", "seconds", "duration_scale", "steps", "max_seconds", "timestamps", "prompt"}
SYNTHESIZE = {"voice", "language", "seed"}
MAX_SEED = 2**53 - 1
DTYPE = torch.bfloat16

# The implementation's languages by the BCP 47 tag the bench names them with.
LANGUAGES = {"zh": "chinese", "en": "english", "ja": "japanese", "ko": "korean", "de": "german", "fr": "french",
             "ru": "russian", "pt": "portuguese", "es": "spanish", "it": "italian"}


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
    """The implementation's float audio as base64 16-bit little-endian samples, the chunk the protocol carries."""
    samples = np.round(np.clip(np.asarray(audio, dtype=np.float32), -1, 1) * 32767).astype("<i2")
    return base64.b64encode(samples.tobytes()).decode("ascii"), samples.size


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


def check_members(request, taken):
    """Refuses a member the request's type does not have, and an option of the vocabulary the adapter does not take."""
    for name, value in request.items():
        if name in ("type", "id") or name in taken or value is None:
            continue
        if name in VOCABULARY:
            raise RequestError("unsupported", name, f"the Qwen3-TTS adapter takes no {name}")
        raise RequestError("invalid_argument", name, f"{request['type']} has no member {name}")


def model_info(tts, device):
    return {
        "architecture": "qwen3-tts",
        "task": "synthesis",
        "sample_rate": tts.model.speech_tokenizer.get_output_sample_rate(),
        "incremental": False,
        "languages": list(LANGUAGES),
        "voices": [{"name": name, "language": "", "gender": "", "description": ""} for name in tts.get_supported_speakers()],
        "device": device,
    }


def synthesize(tts, request):
    check_members(request, SYNTHESIZE | {"text"})
    text, voice, tag = request.get("text"), request.get("voice"), request.get("language") or "auto"
    if not isinstance(text, str) or not text:
        raise RequestError("invalid_argument", "text", "a synthesis needs a text")
    speakers = tts.get_supported_speakers()
    if not isinstance(voice, str) or voice.lower() not in speakers:
        raise RequestError("out_of_range", "voice", f"there is no voice {voice}; the voices are {', '.join(speakers)}")
    if not isinstance(tag, str) or (tag.lower() != "auto" and tag.split("-")[0].lower() not in LANGUAGES):
        raise RequestError("out_of_range", "language", f"Qwen3-TTS does not speak {tag}; it speaks {', '.join(LANGUAGES)}")
    language = "auto" if tag.lower() == "auto" else LANGUAGES[tag.split("-")[0].lower()]
    seed = request.get("seed")
    if seed is not None and not (whole(seed) and 0 <= seed <= MAX_SEED):
        raise RequestError("out_of_range", "seed", f"a seed is a whole number from 0 to {MAX_SEED}")
    if seed is None:
        seed = random.randrange(MAX_SEED + 1)
    torch.manual_seed(seed)
    [audio], _ = tts.generate_custom_voice(text=text, speaker=voice, language=language)
    pcm, samples = pcm16(audio)
    send({"type": "chunk", "id": request["id"], "seq": 0, "pcm": pcm})
    send({"type": "end", "id": request["id"], "seed": seed, "samples": samples, "stop": "complete"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", required=True)
    args = parser.parse_args()

    try:
        torch.set_grad_enabled(False)
        version = json.loads(importlib.metadata.distribution("qwen-tts").read_text("direct_url.json"))["vcs_info"]["commit_id"]
        check_device(args.device)
        tts = Qwen3TTSModel.from_pretrained(args.model, dtype=DTYPE, device_map=args.device)
        if tts.model.tts_model_type != "custom_voice":
            raise RuntimeError(f"{args.model} is a {tts.model.tts_model_type} model, and the adapter runs CustomVoice models")
    except Exception as error:
        send({"type": "fatal", "error": {"code": "model_file", "option": None, "message": str(error)}})
        return 1
    send({"type": "ready", "protocol": 3, "version": version, "model": model_info(tts, args.device)})

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
                synthesize(tts, request)
            elif kind == "info":
                check_members(request, set())
                send({"type": "end", "id": request["id"], "model": model_info(tts, args.device)})
            else:
                raise RequestError("unsupported", "type", f"the Qwen3-TTS adapter takes no {kind}")
        except RequestError as error:
            send({"type": "error", "id": request["id"], "error": error.error})
        except Exception as error:
            send({"type": "error", "id": request["id"], "error": {"code": "internal", "option": None, "message": str(error)}})
    return 0


if __name__ == "__main__":
    sys.exit(main())
