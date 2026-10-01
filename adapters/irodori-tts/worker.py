"""Irodori-TTS's official PyTorch runtime behind speech.cpp's worker protocol, so that the bench measures the
original the way it measures the port.

usage: worker.py --checkpoint model.safetensors --codec weights.pth --device mps|cpu|cuda [--seed n]
                 [--steps n] --voice NAME=FILE ...

The tokenizer is read from the folder `tokenizer/` beside the checkpoint, as the runtime looks for it there. The
runtime does not stream, so each sentence is sent as one chunk once it is spoken. SilentCipher's watermark is left
out, as speech.cpp leaves it out: the runtime applies it whenever the package is installed, and Irodori-TTS lists
the package as a dependency.
"""

import argparse
import base64
import json
import sys

import torch
from irodori_tts import inference_runtime as ir

PREFIX = "ASIST_JSON:"


def send(message):
    print(PREFIX + json.dumps(message, ensure_ascii=False), flush=True)


def pcm16(audio):
    """The runtime's float audio as base64 16-bit little-endian samples, the chunk the protocol carries."""
    samples = (audio.squeeze(0).float().clamp(-1, 1) * 32767).round().to(dtype=torch.int16)
    return base64.b64encode(samples.numpy().astype("<i2").tobytes()).decode("ascii")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--codec", required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--steps", type=int)
    parser.add_argument("--voice", action="append", default=[])
    args = parser.parse_args()
    voices = dict(voice.split("=", 1) for voice in args.voice)

    try:
        ir.SilentCipherWatermarker._load_backend = staticmethod(lambda **_: None)
        runtime = ir.InferenceRuntime.from_key(
            ir.RuntimeKey(checkpoint=args.checkpoint, model_device=args.device, codec_repo=args.codec, codec_device=args.device)
        )
        if runtime.watermarker.ready:
            raise RuntimeError("the watermark could not be left out, so the speech would differ from speech.cpp's")
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
            result = runtime.synthesize(ir.SamplingRequest(text=request["text"], ref_wav=voices[request["voice"]], seed=seed, num_steps=args.steps))
            seed = None if seed is None else seed + 1
            send({"type": "chunk", "id": request["id"], "pcm": pcm16(result.audio)})
            send({"type": "end", "id": request["id"]})
        except Exception as error:
            send({"type": "error", "id": request.get("id"), "error": str(error)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
