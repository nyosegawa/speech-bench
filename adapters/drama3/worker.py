"""Fish Audio Drama 3's official implementation, fish-speech's, behind speech.cpp's worker protocol 3, so that the bench
measures the original the way it will measure the port.

usage: worker.py --checkpoint FOLDER --device cuda --temperature T --top-p P [--add-voice NAME=FILE --voice-text NAME=TEXT]...

FOLDER holds the checkpoint as Fish Audio publishes it, with the codec `codec.pth` beside the weights. The model runs as
fish-speech's API server loads it (tools/server/model_manager.py), less the sentence the server speaks to warm up: in
bfloat16, its experts kept in FP8 on the W8A8 Triton kernels of a GPU of SM89 or later, its decoding steps as CUDA
graphs captured on the first request, and the codec on the same GPU. A GPU without FP8 would make the server
dequantize the experts to 70 GB of bfloat16, another computation, which the adapter refuses.

A request is answered as the server answers a streaming /v1/tts request with one reference: the voice's reference and
transcript, the seed given to set_seed(), the temperature and top-p given here, top-k 30 and at most 1024 frames for
each of the chunks fish-speech cuts a text into. The server streams a chunk of text at a time, a sentence's whole.
Each voice's WAVE file is encoded once, when it is added, as the server encodes a reference it keeps in memory, and
later requests reuse its codes.

A request takes `voice`, `language` as a BCP 47 tag or `auto`, which the model does not take and the adapter only
checks against its languages, and `seed`.
"""

import argparse
import base64
import importlib.metadata
import json
import os
import random
import sys
import traceback

# The protocol keeps the stdout the bench gave; descriptor 1 then writes to stderr, so whatever a package prints
# to stdout while it loads or runs lands in the log instead of between two messages.
PROTOCOL = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)
sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
sys.stdout = sys.stderr

import numpy as np  # noqa: E402
import torch  # noqa: E402
from fish_speech.inference_engine import TTSInferenceEngine  # noqa: E402
from fish_speech.models.text2semantic.errors import InvalidInputError  # noqa: E402
from fish_speech.models.text2semantic.fish_omni.fp8_moe import fp8_gemm_supported  # noqa: E402
from fish_speech.models.text2semantic.fish_omni.generate import resolve_drama3_devices, resolve_drama3_dtype  # noqa: E402
from fish_speech.models.text2semantic.inference import launch_thread_safe_queue, load_codec_model, resolve_codec_path  # noqa: E402
from fish_speech.utils.schema import ServeReferenceAudio, ServeTTSRequest  # noqa: E402

# The options of speech.cpp's vocabulary, of which this adapter takes those in SYNTHESIZE besides `type`, `id` and `text`.
VOCABULARY = {"voice", "language", "seed", "speed", "seconds", "duration_scale", "steps", "max_seconds", "timestamps", "prompt"}
SYNTHESIZE = {"voice", "language", "seed"}
MAX_SEED = 2**31
# The languages of the model card's metadata at the pinned revision, as BCP 47 tags: `jw` there is Javanese, `jv`.
LANGUAGES = [
    "zh", "en", "ja", "ko", "es", "pt", "ar", "ru", "fr", "de", "sv", "it", "tr", "no", "nl", "cy", "eu", "ca", "da", "gl",
    "ta", "hu", "fi", "pl", "et", "hi", "la", "ur", "th", "vi", "jv", "bn", "yo", "sl", "cs", "sw", "nn", "he", "ms", "uk",
    "id", "kk", "bg", "lv", "my", "tl", "sk", "ne", "fa", "af", "el", "bo", "hr", "ro", "sn", "mi", "yi", "am", "be", "km",
    "is", "az", "sd", "br", "sq", "ps", "mn", "ht", "ml", "sr", "sa", "te", "ka", "bs", "pa", "lt", "kn", "si", "hy", "mr",
    "as", "gu", "fo",
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


def pcm16(audio):
    """The implementation's float audio as base64 16-bit little-endian samples, the chunk the protocol carries."""
    samples = np.round(np.clip(np.asarray(audio, dtype=np.float32), -1, 1) * 32767).astype("<i2")
    return base64.b64encode(samples.tobytes()).decode("ascii"), samples.size


def check_members(request, taken):
    """Refuses a member the request's type does not have, and an option of the vocabulary the adapter does not take."""
    for name, value in request.items():
        if name in ("type", "id") or name in taken or value is None:
            continue
        if name in VOCABULARY:
            raise RequestError("unsupported", name, f"the Drama 3 adapter takes no {name}")
        raise RequestError("invalid_argument", name, f"{request['type']} has no member {name}")


def model_info(engine, voices, device):
    return {
        "architecture": "fish_omni",
        "task": "synthesis",
        "sample_rate": engine.decoder_model.sample_rate,
        "incremental": False,
        "languages": LANGUAGES,
        "voices": [{"name": name, "language": "", "gender": "", "description": ""} for name in voices],
        "device": device,
    }


def synthesize(engine, voices, sampling, request):
    check_members(request, SYNTHESIZE | {"text"})
    text, voice, tag = request.get("text"), request.get("voice"), request.get("language") or "auto"
    if not isinstance(text, str) or not text:
        raise RequestError("invalid_argument", "text", "a synthesis needs a text")
    if voice not in voices:
        raise RequestError("out_of_range", "voice", f"there is no voice {voice}; the voices are {', '.join(voices) or 'none'}")
    if not isinstance(tag, str) or (tag.lower() != "auto" and tag.split("-")[0].lower() not in LANGUAGES):
        raise RequestError("out_of_range", "language", f"Drama 3 does not speak {tag}")
    seed = request.get("seed")
    if seed is not None and not (whole(seed) and 0 <= seed <= MAX_SEED):
        raise RequestError("out_of_range", "seed", f"a seed is a whole number from 0 to {MAX_SEED}, as set_seed() takes it")
    if seed is None:
        seed = random.randrange(MAX_SEED + 1)
    served = ServeTTSRequest(text=text, references=[voices[voice]], seed=seed, use_memory_cache="on", streaming=True, **sampling)
    seq, samples = 0, 0
    for result in engine.inference(served):
        if result.code == "error":
            # The server answers an InvalidInputError, bad text or references, with 400 and anything else with 500.
            if isinstance(result.error, InvalidInputError):
                raise RequestError("invalid_argument", "text", str(result.error))
            raise result.error
        if result.code == "segment":
            pcm, count = pcm16(result.audio[1])
            send({"type": "chunk", "id": request["id"], "seq": seq, "pcm": pcm})
            seq, samples = seq + 1, samples + count
    send({"type": "end", "id": request["id"], "seed": seed, "samples": samples, "stop": "complete"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--device", required=True, choices=["cuda"])
    parser.add_argument("--temperature", type=float, required=True)
    parser.add_argument("--top-p", type=float, required=True)
    parser.add_argument("--add-voice", action="append", default=[])
    parser.add_argument("--voice-text", action="append", default=[])
    args = parser.parse_args()

    try:
        torch.set_grad_enabled(False)
        version = json.loads(importlib.metadata.distribution("fish-speech").read_text("direct_url.json"))["vcs_info"]["commit_id"]
        if not torch.cuda.is_available():
            raise RuntimeError(f"PyTorch {torch.__version__} finds no CUDA device; install the NVIDIA driver")
        devices, tower_device = resolve_drama3_devices(args.device)
        if not fp8_gemm_supported(devices):
            raise RuntimeError(f"{torch.cuda.get_device_name()} has no FP8 tensor cores (SM89 or later), on which the official implementation computes Drama 3's experts")
        precision = resolve_drama3_dtype(torch.bfloat16, [*devices, tower_device])
        queue = launch_thread_safe_queue(checkpoint_path=args.checkpoint, device=args.device, precision=precision, compile=False)
        codec = load_codec_model(resolve_codec_path(args.checkpoint, None), tower_device, precision)
        engine = TTSInferenceEngine(llama_queue=queue, decoder_model=codec, precision=precision, compile=False, model_family="drama3")
        texts = dict(entry.split("=", 1) for entry in args.voice_text)
        voices = {}
        for name, path in (entry.split("=", 1) for entry in args.add_voice):
            if name not in texts:
                raise RuntimeError(f"the voice {name} has no transcript; give it with --voice-text {name}=TEXT")
            with open(path, "rb") as f:
                voices[name] = ServeReferenceAudio(audio=f.read(), text=texts[name])
            engine.load_references(ServeTTSRequest(text=texts[name], references=[voices[name]], use_memory_cache="on"))
        sampling = {"temperature": args.temperature, "top_p": args.top_p}
    except Exception as error:
        traceback.print_exc()
        send({"type": "fatal", "error": {"code": "model_file", "option": None, "message": str(error)}})
        return 1
    send({"type": "ready", "protocol": 3, "version": version, "model": model_info(engine, voices, args.device)})

    # Each request is answered before the next line is read, so no request is in flight when a line arrives: a
    # cancel names one that has had its answer, and an id is never one in flight.
    for line in sys.stdin.buffer:
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
                synthesize(engine, voices, sampling, request)
            elif kind == "info":
                check_members(request, set())
                send({"type": "end", "id": request["id"], "model": model_info(engine, voices, args.device)})
            else:
                raise RequestError("unsupported", "type", f"the Drama 3 adapter takes no {kind}")
        except RequestError as error:
            send({"type": "error", "id": request["id"], "error": error.error})
        except Exception as error:
            traceback.print_exc()
            send({"type": "error", "id": request["id"], "error": {"code": "internal", "option": None, "message": str(error)}})
    return 0


if __name__ == "__main__":
    sys.exit(main())
