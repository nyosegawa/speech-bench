"""Irodori-TTS's official PyTorch runtime behind speech.cpp's worker protocol, so that the bench measures the
original the way it measures the port.

usage: worker.py --checkpoint model.safetensors --codec weights.pth --device mps|cpu|cuda [--seed n]
                 [--steps n] --voice NAME=FILE ...

The tokenizer is read from the folder `tokenizer/` beside the checkpoint, as the runtime looks for it there. The
runtime does not stream, so each sentence is sent as one chunk once it is spoken. SilentCipher's watermark is left
out, as speech.cpp leaves it out: the runtime applies it whenever the package is installed, and Irodori-TTS lists
the package as a dependency.

Each voice's WAVE file is encoded once, before `ready`, the way the runtime encodes a `ref_wav`, and every request
is given the latent as a `ref_latent`. Given the WAVE file, the runtime encodes it again for every sentence, which
speech.cpp's worker, given a voice file, does not. The runtime's own timings of each stage go to stderr.
"""

import argparse
import base64
import json
import os
import sys
import tempfile

# The protocol keeps the stdout the bench gave; descriptor 1 then writes to stderr, so whatever a package prints
# to stdout while it loads or runs lands in the log instead of between two messages.
PROTOCOL = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)
sys.stdout = sys.stderr

import torch  # noqa: E402
from irodori_tts import inference_runtime as ir  # noqa: E402


def send(message):
    print(json.dumps(message, ensure_ascii=False), file=PROTOCOL, flush=True)


def pcm16(audio):
    """The runtime's float audio as base64 16-bit little-endian samples, the chunk the protocol carries."""
    samples = (audio.squeeze(0).float().clamp(-1, 1) * 32767).round().to(dtype=torch.int16)
    return base64.b64encode(samples.numpy().astype("<i2").tobytes()).decode("ascii")


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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--codec", required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--steps", type=int)
    parser.add_argument("--voice", action="append", default=[])
    args = parser.parse_args()
    latents = tempfile.TemporaryDirectory()

    try:
        ir.SilentCipherWatermarker._load_backend = staticmethod(lambda **_: None)
        runtime = ir.InferenceRuntime.from_key(
            ir.RuntimeKey(checkpoint=args.checkpoint, model_device=args.device, codec_repo=args.codec, codec_device=args.device)
        )
        if runtime.watermarker.ready:
            raise RuntimeError("the watermark could not be left out, so the speech would differ from speech.cpp's")
        voices = {name: encode_voice(runtime, path, latents.name) for name, path in (voice.split("=", 1) for voice in args.voice)}
    except Exception as error:
        send({"type": "fatal", "error": str(error)})
        return 1
    send({"type": "ready", "sampleRate": int(runtime.codec.sample_rate)})

    # As speech.cpp's worker does, the seed given applies to the first request and each later one takes the next;
    # without one, the runtime draws a seed for each request.
    seed = args.seed
    for line in sys.stdin:
        request = json.loads(line)
        try:
            if request["language"].split("-")[0] != "ja":
                raise ValueError(f"Irodori-TTS speaks Japanese, not {request['language']}")
            if request["voice"] not in voices:
                raise ValueError(f"there is no voice {request['voice']}; the worker was given {', '.join(voices) or 'none'}")
            result = runtime.synthesize(ir.SamplingRequest(text=request["text"], ref_latent=voices[request["voice"]], seed=seed, num_steps=args.steps))
            print(json.dumps({"id": request["id"], "stages": result.stage_timings}), file=sys.stderr, flush=True)
            seed = None if seed is None else seed + 1
            send({"type": "chunk", "id": request["id"], "pcm": pcm16(result.audio)})
            send({"type": "end", "id": request["id"]})
        except Exception as error:
            send({"type": "error", "id": request.get("id"), "error": str(error)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
