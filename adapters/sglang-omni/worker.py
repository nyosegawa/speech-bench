"""Fish Audio Drama 3 served by SGLang Omni behind speech.cpp's worker protocol 3, so that the bench measures the model in
the server Fish Audio's cookbook serves it with, in its official FP8 checkpoint and in the others SGLang Omni reads.

usage: worker.py --checkpoint FOLDER --device cuda --temperature T --top-p P --top-k K [--add-voice NAME=FILE --voice-text NAME=TEXT]...

FOLDER holds a checkpoint as its repository publishes it, with the codec `codec.pth` beside the weights. The adapter
starts `sgl-omni serve` on it, on a free port of 127.0.0.1, with SGLang Omni's defaults for Drama 3: the preprocessing,
the engine and the vocoder on GPU 0, each in a process of its own, the engine filling 0.70 of the GPU's memory with the
weights and a KV cache beside budgets of 0.10 for the vocoder and 6 GiB for the preprocessing, and the weights as the
checkpoint's quantization names them, bfloat16 with FP8 experts in the official checkpoint and GPTQ int4 experts and
attention projections on GPTQ-Marlin kernels in fishaudio/drama-3-int4. The codec is the one in FOLDER, where the
server would otherwise fetch S2-Pro's from the Hub, the same file by its sha256. The server's output goes to the
adapter's stderr. A server that exits, or does not answer /health as healthy within START_SECONDS, stops the adapter
with `fatal`, and the server is stopped whenever the adapter ends.

A request is answered as the server answers a streaming POST /v1/audio/speech with one reference, the voice's WAVE
file by its path with its transcript, sampled with the temperature, top-p and top-k given here: the raw 16-bit
little-endian PCM it streams goes out as `chunk` messages as it arrives, and `end` follows once the stream has ended,
with the stop the server's finish reason gives, which GET /v1/audio/speech/{id} keeps. The server truncates its float
audio to 16 bits where speech.cpp rounds, so a sample may lie one step closer to zero than speech.cpp would put it.

The server encodes a reference the first time a request gives it and keeps the codes (reference_encoder.get_or_encode),
and has no way to encode one without a request. Before `ready` the adapter sends each voice one request of
ENCODING_FRAMES frames, its own transcript as the text, so that the encoding happens before any timed request; its
stream gives the sample rate that `ready` reports.

SGLang Omni refuses a seed for Drama 3 (speech_request.py's UNSUPPORTED_PARAMS): the engine samples from generators
seeded once when it starts. A request with a seed is refused as unsupported, and `end` gives the seed as null.

A request takes `voice` and `language` as a BCP 47 tag or `auto`, which the model does not take and the adapter only
checks against its languages.
"""

import argparse
import base64
import http.client
import importlib.metadata
import json
import os
import signal
import socket
import subprocess
import sys
import time
import traceback

# The protocol keeps the stdout the bench gave; descriptor 1 then writes to stderr, so whatever a package prints
# to stdout while it loads or runs lands in the log instead of between two messages.
PROTOCOL = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)
sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
sys.stdout = sys.stderr

# The options of speech.cpp's vocabulary, of which this adapter takes those in SYNTHESIZE besides `type`, `id` and `text`.
VOCABULARY = {"voice", "language", "seed", "speed", "seconds", "duration_scale", "steps", "max_seconds", "timestamps", "prompt"}
SYNTHESIZE = {"voice", "language"}
# Why an option of the vocabulary is refused, where its name alone does not say what to do.
REFUSALS = {"seed": "SGLang Omni takes no seed for Drama 3, whose engine samples from generators seeded once when it starts; run without --seeds"}
# The languages of the model card's metadata at the official checkpoint's pinned revision, as BCP 47 tags: `jw` there
# is Javanese, `jv`.
LANGUAGES = [
    "zh", "en", "ja", "ko", "es", "pt", "ar", "ru", "fr", "de", "sv", "it", "tr", "no", "nl", "cy", "eu", "ca", "da", "gl",
    "ta", "hu", "fi", "pl", "et", "hi", "la", "ur", "th", "vi", "jv", "bn", "yo", "sl", "cs", "sw", "nn", "he", "ms", "uk",
    "id", "kk", "bg", "lv", "my", "tl", "sk", "ne", "fa", "af", "el", "bo", "hr", "ro", "sn", "mi", "yi", "am", "be", "km",
    "is", "az", "sd", "br", "sq", "ps", "mn", "ht", "ml", "sr", "sa", "te", "ka", "bs", "pa", "lt", "kn", "si", "hy", "mr",
    "as", "gu", "fo",
]
HOST = "127.0.0.1"
# SGLang Omni gives its stages 600 s to start unless SGLANG_OMNI_STARTUP_TIMEOUT says otherwise, and its benchmark
# guides give them 1800 s, since a cold start can take longer than 600 s to capture its CUDA graphs. The server is given
# that long, and the adapter waits as long for its /health.
START_SECONDS = 1800
POLL_SECONDS = 0.2
# How long the adapter waits for the server's next bytes before it takes the server for hung.
REPLY_SECONDS = 300
# How long a stopping server may take to stop its stages before the adapter kills them.
STOP_SECONDS = 60
# The frames of the request that encodes a voice before `ready`: a few, so that it costs little beyond the encoding.
ENCODING_FRAMES = 8
# The most PCM bytes read at once, more than the longest window of the vocoder's stream holds (64 frames of 2048
# samples), so that the reads do not cut the stream finer than the socket delivers it.
READ_BYTES = 1 << 20
# The finish reasons SGLang gives a request, as speech.cpp's stops: the end-of-speech frame, or max_new_tokens.
STOPS = {"stop": "complete", "length": "model_limit"}


class RequestError(Exception):
    """A request refused as speech.cpp's worker refuses one: the library's code, the input at fault and why."""

    def __init__(self, code, option, message):
        super().__init__(message)
        self.error = {"code": code, "option": option, "message": message}


def send(message):
    print(json.dumps(message, ensure_ascii=False), file=PROTOCOL, flush=True)


def check_members(request, taken):
    """Refuses a member the request's type does not have, and an option of the vocabulary the adapter does not take."""
    for name, value in request.items():
        if name in ("type", "id") or name in taken or value is None:
            continue
        if name in VOCABULARY:
            raise RequestError("unsupported", name, REFUSALS.get(name, f"the SGLang Omni adapter takes no {name}"))
        raise RequestError("invalid_argument", name, f"{request['type']} has no member {name}")


def model_info(architecture, sample_rate, voices, device):
    return {
        "architecture": architecture,
        "task": "synthesis",
        "sample_rate": sample_rate,
        "incremental": True,
        "languages": LANGUAGES,
        "voices": [{"name": name, "language": "", "gender": "", "description": ""} for name in voices],
        "device": device,
    }


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((HOST, 0))
        return probe.getsockname()[1]


def start_server(checkpoint, port):
    """Starts `sgl-omni serve` in a process group of its own, which its stages' processes join."""
    command = [
        os.path.join(sys.prefix, "bin", "sgl-omni"), "serve", "--model-path", checkpoint, "--host", HOST, "--port", str(port),
        "--vocoder.factory.codec_path", os.path.join(checkpoint, "codec.pth"),
    ]
    # Without SGLANG_OMNI_STRICT_PORT the server takes another port when the one given is taken, where no one asks.
    environment = {**os.environ, "SGLANG_OMNI_STRICT_PORT": "1", "SGLANG_OMNI_STARTUP_TIMEOUT": str(START_SECONDS)}
    return subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=sys.stderr, stderr=sys.stderr, env=environment, start_new_session=True)


def stop_server(server):
    if server.poll() is None:
        server.terminate()
        try:
            server.wait(timeout=STOP_SECONDS)
        except subprocess.TimeoutExpired:
            pass
    # A server ended before its HTTP side ran, or one that did not stop in time, leaves its stages' processes behind.
    try:
        os.killpg(server.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    server.wait()


def get(port, path):
    connection = http.client.HTTPConnection(HOST, port, timeout=REPLY_SECONDS)
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


def wait_for_server(server, port):
    deadline = time.monotonic() + START_SECONDS
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise RuntimeError(f"sgl-omni serve exited with code {server.returncode} before it was ready; its output is in this log")
        try:
            if get(port, "/health")[0] == 200:
                return
        except (OSError, http.client.HTTPException):
            pass
        time.sleep(POLL_SECONDS)
    raise RuntimeError(f"sgl-omni serve did not report itself healthy within {START_SECONDS} s; its output is in this log")


def speech_body(text, reference, sampling, max_frames=None):
    body = {"input": text, "references": [reference], "stream": True, "response_format": "pcm", **sampling}
    if max_frames is not None:
        body["max_new_tokens"] = max_frames
    return body


def error_message(body):
    try:
        return json.loads(body)["error"]["message"]
    except (ValueError, KeyError, TypeError):
        return body.decode("utf-8", errors="replace")


def speak(port, body, rate, on_audio):
    """
    Sends a streaming speech request and passes its 16-bit samples to on_audio as they arrive, refusing a stream at
    another rate than `rate` when one is given. Returns the stream's sample rate and the request's stop.
    """
    connection = http.client.HTTPConnection(HOST, port, timeout=REPLY_SECONDS)
    try:
        connection.request("POST", "/v1/audio/speech", json.dumps(body, ensure_ascii=False).encode("utf-8"), {"Content-Type": "application/json"})
        response = connection.getresponse()
        if response.status != 200:
            message = error_message(response.read())
            # The server answers a request its text or reference makes impossible with 400 and anything else otherwise.
            if response.status == 400:
                raise RequestError("invalid_argument", "text", message)
            raise RuntimeError(f"the server answered {response.status}: {message}")
        channels, bits, given = response.getheader("X-Channels"), response.getheader("X-Bit-Depth"), response.getheader("X-Sample-Rate")
        if channels != "1" or bits != "16" or not (given or "").isdigit():
            raise RuntimeError(f"the server streams {channels} channels of {bits}-bit PCM at {given} Hz, where the adapter takes one channel of 16 bits")
        if rate is not None and int(given) != rate:
            raise RuntimeError(f"the server streams at {given} Hz, where it streamed at {rate} Hz before")
        carry = b""
        try:
            while data := response.read1(READ_BYTES):
                data = carry + data
                whole = len(data) - len(data) % 2
                carry = data[whole:]
                if whole:
                    on_audio(data[:whole])
        except http.client.IncompleteRead as error:
            raise RuntimeError("the server broke off the stream before its end; its output in this log says why") from error
        if carry:
            raise RuntimeError("the server's PCM stream ended in the middle of a sample")
        stream = response.getheader("X-Request-Id")
    finally:
        connection.close()
    status, outcome = get(port, f"/v1/audio/speech/{stream}")
    if status != 200:
        raise RuntimeError(f"the server keeps no outcome of stream {stream}: {status} {error_message(outcome)}")
    reason = json.loads(outcome)["finish_reason"]
    if reason not in STOPS:
        raise RuntimeError(f"the server ended stream {stream} with the finish reason {reason!r}")
    return int(given), STOPS[reason]


def synthesize(port, voices, sampling, sample_rate, request):
    check_members(request, SYNTHESIZE | {"text"})
    text, voice, tag = request.get("text"), request.get("voice"), request.get("language") or "auto"
    if not isinstance(text, str) or not text:
        raise RequestError("invalid_argument", "text", "a synthesis needs a text")
    if voice not in voices:
        raise RequestError("out_of_range", "voice", f"there is no voice {voice}; the voices are {', '.join(voices) or 'none'}")
    if not isinstance(tag, str) or (tag.lower() != "auto" and tag.split("-")[0].lower() not in LANGUAGES):
        raise RequestError("out_of_range", "language", f"Drama 3 does not speak {tag}")
    seq, samples = 0, 0

    def pass_on(pcm):
        nonlocal seq, samples
        send({"type": "chunk", "id": request["id"], "seq": seq, "pcm": base64.b64encode(pcm).decode("ascii")})
        seq, samples = seq + 1, samples + len(pcm) // 2

    stop = speak(port, speech_body(text, voices[voice], sampling), sample_rate, pass_on)[1]
    send({"type": "end", "id": request["id"], "seed": None, "samples": samples, "stop": stop})


def leave(signum, frame):
    raise SystemExit(128 + signum)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--device", required=True, choices=["cuda"])
    parser.add_argument("--temperature", type=float, required=True)
    parser.add_argument("--top-p", type=float, required=True)
    parser.add_argument("--top-k", type=int, required=True)
    parser.add_argument("--add-voice", action="append", default=[])
    parser.add_argument("--voice-text", action="append", default=[])
    args = parser.parse_args()

    # The bench stops a worker with SIGTERM, whose default would end the adapter and leave the server running.
    signal.signal(signal.SIGTERM, leave)
    server = None
    try:
        try:
            version = json.loads(importlib.metadata.distribution("sglang-omni").read_text("direct_url.json"))["vcs_info"]["commit_id"]
            with open(os.path.join(args.checkpoint, "config.json"), encoding="utf-8") as f:
                architecture = json.load(f)["model_type"]
            texts = dict(entry.split("=", 1) for entry in args.voice_text)
            voices = {}
            for name, path in (entry.split("=", 1) for entry in args.add_voice):
                if name not in texts:
                    raise RuntimeError(f"the voice {name} has no transcript; give it with --voice-text {name}=TEXT")
                if not os.path.isfile(path):
                    raise RuntimeError(f"the voice {name}'s WAVE file {path} does not exist")
                voices[name] = {"audio_path": os.path.abspath(path), "text": texts[name]}
            if not voices:
                raise RuntimeError("Drama 3 has no voice of its own here, and the rate of its audio is read from a voice's first request; give one with --add-voice NAME=FILE and --voice-text NAME=TEXT")
            sampling = {"temperature": args.temperature, "top_p": args.top_p, "top_k": args.top_k}
            port = free_port()
            server = start_server(args.checkpoint, port)
            wait_for_server(server, port)
            sample_rate = None
            for reference in voices.values():
                sample_rate = speak(port, speech_body(reference["text"], reference, sampling, ENCODING_FRAMES), sample_rate, lambda pcm: None)[0]
        except Exception as error:
            traceback.print_exc()
            send({"type": "fatal", "error": {"code": "model_file", "option": None, "message": str(error)}})
            return 1
        send({"type": "ready", "protocol": 3, "version": version, "model": model_info(architecture, sample_rate, voices, args.device)})

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
                    synthesize(port, voices, sampling, sample_rate, request)
                elif kind == "info":
                    check_members(request, set())
                    send({"type": "end", "id": request["id"], "model": model_info(architecture, sample_rate, voices, args.device)})
                else:
                    raise RequestError("unsupported", "type", f"the SGLang Omni adapter takes no {kind}")
            except RequestError as error:
                send({"type": "error", "id": request["id"], "error": error.error})
            except Exception as error:
                traceback.print_exc()
                send({"type": "error", "id": request["id"], "error": {"code": "internal", "option": None, "message": str(error)}})
        return 0
    finally:
        if server is not None:
            stop_server(server)


if __name__ == "__main__":
    sys.exit(main())
