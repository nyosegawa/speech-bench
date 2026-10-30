"""VibeVoice-ASR-Streaming as the official code runs it, behind speech.cpp's worker protocol 3, so that the bench
measures the original the way it measures a port.

usage: worker.py --model FOLDER --device mps|cuda --seed N

FOLDER holds the checkpoint as Microsoft publishes it: its configuration, preprocessor configuration, tokenizer and
weights. The model is VibeVoice's VibeVoiceASRForConditionalGeneration in bfloat16 with PyTorch's own attention (SDPA),
as VibeVoice's streaming demos load it on CUDA, and its tokenizer is the one VibeVoiceASRProcessor loads.

An utterance is transcribed as demo/vibevoice_asr_streaming_inference_from_file.py transcribes a file: the whole
utterance goes through streaming_generate(), which feeds the model windows of the chunk and lookahead that
preprocessor_config.json gives, after the prompt without hotwords, and decodes greedily with at most 256 new tokens a
chunk. The model writes each chunk's text after a speaker's label where the speaker changes (` \n Speaker 0:...`), and
a chunk without speech as a tag (`[Silence]`, `[Noise]`); the chunks are put together into segments by VibeVoice's own
chunk_segments(), and the text is the content of the segments without their labels and tags, in one paragraph as
VibeVoice's tidy_body() folds the text of a segment.

The acoustic tokenizer adds Gaussian noise to its latents as in training (`std_dist_type` "gaussian" in config.json),
and PyTorch seeds its generators anew in each process: unseeded, one Japanese utterance of Common Voice came back as
four different texts in four runs on an Apple M5 (2026-10-30). The generators are seeded with N before each utterance,
so that an utterance has the same text in every run on a machine, whatever the order it comes in.

A recognition request is its audio in `chunk` messages of base64 16-bit PCM numbered from 0, then `transcribe` with
`sample_rate` and, optionally, `language` as a BCP 47 tag, which is only checked against the languages of the model
card: the model's prompt has no place for a language, and it finds the language itself.
"""

import argparse
import base64
import importlib.metadata
import importlib.util
import json
import os
import re
import sys
import traceback

# The protocol keeps the stdout the bench gave; descriptor 1 then writes to stderr, so whatever a package prints
# to stdout while it loads or runs lands in the log instead of between two messages.
PROTOCOL = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)
# Python writes a pipe in the ANSI code page on Windows; the log is UTF-8 on every system.
sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
sys.stdout = sys.stderr

import librosa  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402
from vibevoice.modular.modeling_vibevoice_asr import VibeVoiceASRForConditionalGeneration  # noqa: E402
from vibevoice.processor.vibevoice_asr_processor import VibeVoiceASRProcessor  # noqa: E402

# The options of speech.cpp's vocabulary, of which this adapter takes those in TRANSCRIBE besides `type`, `id` and
# `sample_rate`.
VOCABULARY = {"language", "prompt", "timestamps", "decoding", "max_seconds"}
TRANSCRIBE = {"language"}
MAX_NEW_TOKENS = 256
DTYPE = torch.bfloat16

# A tag the model writes in place of words, such as `[Silence]` or `[Noise]`, bracketed as chunk_segments() finds it.
TAG = re.compile(r"\[[^\[\]]*\]")

# The languages of the model card (revision 60d858b5), as BCP 47 tags.
LANGUAGES = ["en", "zh", "es", "pt", "de", "ja", "ko", "fr", "ru", "it"]


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


def asr_streaming():
    """VibeVoice's vllm_plugin/asr_streaming.py, loaded from its file: importing the package runs its __init__, which
    imports vLLM to register the model with it."""
    package = importlib.util.find_spec("vllm_plugin").submodule_search_locations[0]
    spec = importlib.util.spec_from_file_location("vibevoice_asr_streaming", os.path.join(package, "asr_streaming.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def holds_kernels_for(major, minor):
    """Whether PyTorch's build holds kernels a GPU of compute capability major.minor runs: machine code of its major for
    a minor at most its own, which CUDA runs on the later minors of a major, as sm_86's on an RTX 4090 (sm_89), or PTX
    of a capability at most its own, which the driver compiles."""
    for arch in torch.cuda.get_arch_list():
        kind, _, number = arch.partition("_")
        number = number.rstrip("abcdefghijklmnopqrstuvwxyz")
        built = (int(number[:-1]), int(number[-1]))
        if (kind == "sm" and built[0] == major and built[1] <= minor) or (kind == "compute" and built <= (major, minor)):
            return True
    return False


def check_device(device):
    """Refuses a device PyTorch cannot run on here, rather than letting it fall back to the CPU."""
    if device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("PyTorch finds no Metal device (MPS) on this machine")
    if device == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError(f"PyTorch {torch.__version__} finds no CUDA device; install the NVIDIA driver, or check that uv installed PyTorch's CUDA build")
        major, minor = torch.cuda.get_device_capability()
        if not holds_kernels_for(major, minor):
            raise RuntimeError(f"PyTorch {torch.__version__} has no kernels for {torch.cuda.get_device_name()} (sm_{major}{minor}); it has {', '.join(torch.cuda.get_arch_list())}")
    if device not in ("mps", "cuda"):
        raise RuntimeError(f"the adapter runs on a GPU, mps or cuda, not {device}")


class Counted:
    """The tokenizer given to streaming_generate(), which keeps the number of tokens of each chunk it decodes:
    streaming_generate() yields a chunk's text alone, and a chunk that has as many tokens as the most it lets a chunk
    have is one whose text the limit cut."""

    def __init__(self, tokenizer):
        self.tokenizer = tokenizer
        self.lengths = []

    def __getattr__(self, name):
        return getattr(self.tokenizer, name)

    def decode(self, ids, **kwargs):
        self.lengths.append(len(ids))
        return self.tokenizer.decode(ids, **kwargs)


class Recognizer:
    def __init__(self, folder, device, seed):
        self.seed = seed
        self.streaming = asr_streaming()
        # The chunk and the lookahead the checkpoint was trained on, which ChunkGeometry reads from
        # preprocessor_config.json and refuses a checkpoint without.
        self.geometry = self.streaming.ChunkGeometry.from_pretrained(folder)
        self.tokenizer = VibeVoiceASRProcessor.from_pretrained(folder).tokenizer
        if self.tokenizer.text_chunk_end_id is None:
            raise RuntimeError(f"{folder} is not a streaming checkpoint: its tokenizer has no <|text_chunk_end|>")
        # device_map puts the weights on the GPU as they are read, as the streaming FastAPI demo loads them, where the
        # file demo loads all 17 GB on the CPU and then moves them with .to().
        model, info = VibeVoiceASRForConditionalGeneration.from_pretrained(
            folder, dtype=DTYPE, attn_implementation="sdpa", device_map=device, output_loading_info=True)
        # from_pretrained() only warns of a weight the checkpoint lacks or holds beyond the model's.
        faults = {kind: names for kind, names in info.items() if names}
        if faults:
            raise RuntimeError(f"the checkpoint's weights do not match VibeVoice's ASR model: {faults}")
        self.model = model.eval()

    def transcribe(self, samples, rate):
        """The text of the audio and whether a chunk stopped at the most new tokens."""
        model_rate = self.geometry.sample_rate
        # librosa's resampler, as VibeVoice's streaming server resamples audio of another rate: its comment says the
        # streaming checkpoints were evaluated with it, and that ffmpeg's, which the file demo runs, differs by about
        # 1% RMS, which near ties of greedy decoding turn into other words.
        audio = samples if rate == model_rate else librosa.resample(samples, orig_sr=rate, target_sr=model_rate)
        frame = self.geometry.frame_samples / model_rate
        tokenizer = Counted(self.tokenizer)
        torch.manual_seed(self.seed)
        texts = [text for _, _, text in self.model.streaming_generate(
            audio_tensor=torch.from_numpy(audio), tokenizer=tokenizer,
            chunk_duration=self.geometry.chunk_frames * frame, text_audio_delay=self.geometry.lookahead_frames * frame,
            sample_rate=model_rate, max_new_tokens_per_chunk=MAX_NEW_TOKENS, temperature=0.0, context_info=None)]
        segments = self.streaming.chunk_segments(texts, self.geometry, len(audio) / model_rate)
        # A space keeps the words on either side of a segment's end or a tag apart; tidy_body() removes it again
        # between two CJK characters.
        text = self.streaming.tidy_body(TAG.sub(" ", " ".join(segment["Content"] for segment in segments)))
        return text, any(length >= MAX_NEW_TOKENS for length in tokenizer.lengths)


def model_info(recognizer, device):
    return {
        "architecture": "vibevoice-asr-streaming",
        "task": "recognition",
        "sample_rate": recognizer.geometry.sample_rate,
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
            raise RequestError("unsupported", name, f"the VibeVoice-ASR adapter takes no {name}")
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
        raise RequestError("out_of_range", "language", f"VibeVoice-ASR-Streaming does not recognize {tag}; it recognizes {', '.join(LANGUAGES)}")
    if not pieces:
        raise RequestError("invalid_argument", "pcm", "a recognition needs audio")
    samples = np.concatenate(pieces).astype(np.float32) / 32768
    text, limited = recognizer.transcribe(samples, rate)
    send({"type": "end", "id": request["id"], "text": text, "stop": "model_limit" if limited else "complete"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--seed", required=True, type=int)
    args = parser.parse_args()

    try:
        torch.set_grad_enabled(False)
        version = json.loads(importlib.metadata.distribution("vibevoice").read_text("direct_url.json"))["vcs_info"]["commit_id"]
        check_device(args.device)
        recognizer = Recognizer(args.model, args.device, args.seed)
    except Exception as error:
        traceback.print_exc()
        send({"type": "fatal", "error": {"code": "model_file", "option": None, "message": str(error)}})
        return 1
    send({"type": "ready", "protocol": 3, "version": version, "model": model_info(recognizer, args.device)})

    # The audio of each request whose transcribe has not come, and the requests refused before it came, whose later
    # lines are passed over until then.
    audio, refused = {}, set()
    # The lines are read as bytes, which json.loads() decodes as UTF-8, the protocol's encoding. Read as text, a pipe
    # is decoded in the ANSI code page on Windows, which turns Japanese into lone surrogates that a tokenizer refuses.
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
                raise RequestError("unsupported", "type", f"the VibeVoice-ASR adapter takes no {kind}")
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
