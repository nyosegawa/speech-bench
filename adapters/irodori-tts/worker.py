"""Irodori-TTS's official PyTorch runtime behind speech.cpp's worker protocol 2, so that the bench measures the
original the way it measures the port.

usage: worker.py --checkpoint model.safetensors --codec weights.pth --device mps|cpu|cuda [--add-voice NAME=FILE]...

The tokenizer is read from the folder `tokenizer/` beside the checkpoint, as the runtime looks for it there. The
runtime does not stream, so each sentence is sent as one chunk once it is spoken. SilentCipher's watermark is left
out, as speech.cpp leaves it out: the runtime applies it whenever the package is installed, and Irodori-TTS lists
the package as a dependency.

A request takes `voice`, `language` (`ja`, a region of it or `auto`), `seed` and `steps`, as speech.cpp's Irodori-TTS
does. Each voice's WAVE file is encoded once, when it is added, the way the runtime encodes a `ref_wav`, and every
request is given the latent as a `ref_latent`. Given the WAVE file, the runtime encodes it again for every sentence,
which speech.cpp's worker, given a voice file, does not. The runtime's own timings of each stage go to stderr.
"""

import argparse
import base64
import importlib.metadata
import json
import os
import random
import sys
import tempfile

# The protocol keeps the stdout the bench gave; descriptor 1 then writes to stderr, so whatever a package prints
# to stdout while it loads or runs lands in the log instead of between two messages.
PROTOCOL = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)
sys.stdout = sys.stderr

import torch  # noqa: E402
from irodori_tts import inference_runtime as ir  # noqa: E402

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
    """The runtime's float audio as base64 16-bit little-endian samples, the chunk the protocol carries."""
    samples = (audio.squeeze(0).float().clamp(-1, 1) * 32767).round().to(dtype=torch.int16)
    return base64.b64encode(samples.numpy().astype("<i2").tobytes()).decode("ascii"), samples.numel()


def check_members(request, taken):
    """Refuses a member the request's type does not have, and an option of the vocabulary the adapter does not take."""
    for name, value in request.items():
        if name in ("type", "id") or name in taken or value is None:
            continue
        if name in VOCABULARY:
            raise RequestError("unsupported", name, f"the Irodori-TTS adapter takes no {name}")
        raise RequestError("invalid_argument", name, f"{request['type']} has no member {name}")


def encode_voice(runtime, wav_path, folder):
    """A voice's latent saved where a request can name it, encoded with the settings `SamplingRequest` defaults to."""
    request = ir.SamplingRequest(text="")
    wav, rate = ir._load_audio(wav_path)
    if runtime.default_max_ref_seconds > 0:
        wav = wav[:, : max(1, int(runtime.default_max_ref_seconds * rate))]
    latent = runtime.codec.encode_waveform(
        wav.unsqueeze(0), sample_rate=int(rate), normalize_db=request.ref_normalize_db, ensure_max=request.ref_ensure_max
    ).cpu()
    path = os.path.join(folder, f"{len(os.listdir(folder))}.pt")
    torch.save(latent, path)
    return path


def model_info(runtime, voices, device):
    return {
        "architecture": "irodori-tts",
        "task": "synthesis",
        "sample_rate": int(runtime.codec.sample_rate),
        "incremental": False,
        "languages": ["ja"],
        "voices": [{"name": name, "language": "", "gender": "", "description": ""} for name in voices],
        "device": device,
    }


def synthesize(runtime, voices, request):
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
    # The runtime draws a seed of 63 bits when given none, more than the protocol's seeds hold.
    if seed is None:
        seed = random.randrange(MAX_SEED + 1)
    result = runtime.synthesize(ir.SamplingRequest(text=text, ref_latent=voices[voice], seed=seed, num_steps=steps))
    print(json.dumps({"id": request["id"], "stages": result.stage_timings}), file=sys.stderr, flush=True)
    pcm, samples = pcm16(result.audio)
    send({"type": "chunk", "id": request["id"], "seq": 0, "pcm": pcm})
    send({"type": "end", "id": request["id"], "seed": result.used_seed, "samples": samples, "stop": "complete"})


def add_voice(runtime, voices, folder, request):
    check_members(request, {"name", "path"})
    name, path = request.get("name"), request.get("path")
    if not isinstance(name, str) or not name:
        raise RequestError("invalid_argument", "name", "a voice needs a name")
    if not isinstance(path, str) or not path:
        raise RequestError("invalid_argument", "path", "a voice needs the path of a WAVE file")
    try:
        voices[name] = encode_voice(runtime, path, folder)
    except Exception as error:
        raise RequestError("io", "path", f"{path}: {error}") from error
    send({"type": "end", "id": request["id"]})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--codec", required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--add-voice", action="append", default=[])
    args = parser.parse_args()
    latents = tempfile.TemporaryDirectory()

    try:
        version = json.loads(importlib.metadata.distribution("irodori-tts").read_text("direct_url.json"))["vcs_info"]["commit_id"]
        ir.SilentCipherWatermarker._load_backend = staticmethod(lambda **_: None)
        runtime = ir.InferenceRuntime.from_key(
            ir.RuntimeKey(checkpoint=args.checkpoint, model_device=args.device, codec_repo=args.codec, codec_device=args.device)
        )
        if runtime.watermarker.ready:
            raise RuntimeError("the watermark could not be left out, so the speech would differ from speech.cpp's")
        voices = {name: encode_voice(runtime, path, latents.name) for name, path in (voice.split("=", 1) for voice in args.add_voice)}
    except Exception as error:
        send({"type": "fatal", "error": {"code": "model_file", "option": None, "message": str(error)}})
        return 1
    send({"type": "ready", "protocol": 2, "version": version, "model": model_info(runtime, voices, args.device)})

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
                synthesize(runtime, voices, request)
            elif kind == "add_voice":
                add_voice(runtime, voices, latents.name, request)
            elif kind == "info":
                check_members(request, set())
                send({"type": "end", "id": request["id"], "model": model_info(runtime, voices, args.device)})
            else:
                raise RequestError("unsupported", "type", f"the Irodori-TTS adapter takes no {kind}")
        except RequestError as error:
            send({"type": "error", "id": request["id"], "error": error.error})
        except Exception as error:
            send({"type": "error", "id": request["id"], "error": {"code": "internal", "option": None, "message": str(error)}})
    return 0


if __name__ == "__main__":
    sys.exit(main())
