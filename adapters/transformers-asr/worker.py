"""Speech recognition models in transformers, each run as its model card runs it, behind speech.cpp's worker protocol 3,
so that the bench measures them the way it measures the other runtimes.

usage: worker.py --model FOLDER --recipe RECIPE --dtype bf16|fp16|fp32 --device mps|cuda [--instruction TEXT]

FOLDER holds the checkpoint as its repository publishes it. RECIPE names the code of the model's card:

- reazonspeech-ctc: ReazonSpeech's wav2vec 2.0, HuBERT and Zipformer CTC models. The audio is padded with 0.5 s of
  silence on each side, the argmax of the logits is decoded, and the word mark the BPE and Zipformer cards strip from
  the start of the text is stripped; the character vocabularies of the others have no word mark. The Zipformer's
  modeling code is the checkpoint's own, loaded with trust_remote_code from the pinned folder.
- whisper: Whisper and Kotoba-Whisper, `generate()` with the language and the transcribe task, greedy as the
  checkpoint's generation configuration decodes.
- moonshine: Moonshine, with at most 13 tokens a second of audio, the limit its card sets against repetition.
- granite-speech: Granite Speech, told TEXT with `<language>` replaced by the language's name, in the chat template,
  greedily with at most 200 new tokens.
- cohere-asr: Cohere Transcribe, told the language, with at most 256 new tokens.
- voxtral-realtime: Voxtral Realtime, the whole utterance given at once, at the transcription delay its tekken.json
  sets, 480 ms in Voxtral Mini 4B Realtime 2602, the delay its card recommends.

Every model runs in the dtype its card loads it in on CUDA, and in PyTorch's own attention where a card asks for
FlashAttention 2, which the environment does not install. The transformers 4 adapter runs this worker in its own
environment of transformers 4.57 for ReazonSpeech's CTC models.

A recognition request is its audio in `chunk` messages of base64 16-bit PCM numbered from 0, at 16 kHz, then
`transcribe` with `sample_rate` and, optionally, `language` as a BCP 47 tag.
"""

import argparse
import base64
import collections
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
import torch  # noqa: E402
from transformers import (AutoModelForCTC, AutoModelForSpeechSeq2Seq, AutoProcessor,  # noqa: E402
                          MoonshineForConditionalGeneration, WhisperForConditionalGeneration)

# The options of speech.cpp's vocabulary, of which this adapter takes those in TRANSCRIBE besides `type`, `id` and
# `sample_rate`.
VOCABULARY = {"language", "prompt", "timestamps", "decoding", "max_seconds"}
TRANSCRIBE = {"language"}
SAMPLE_RATE = 16000
DTYPES = {"bf16": torch.bfloat16, "fp16": torch.float16, "fp32": torch.float32}


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


def check_dtype(model, dtype):
    """Refuses a model that from_pretrained() left in another dtype than the one the run records, by the dtype that
    holds most of its weights: model.dtype is its first weight's, which in the Zipformer is a mask embedding of
    training kept in FP32 beside 730 weights in BF16."""
    held = collections.Counter()
    for parameter in model.parameters():
        held[parameter.dtype] += parameter.numel()
    loaded = held.most_common(1)[0][0]
    if loaded != dtype:
        raise RuntimeError(f"the model loaded in {loaded}, not in {dtype}")


class ReazonSpeechCtc:
    languages = ["ja"]
    steers = False

    def __init__(self, folder, device, dtype, instruction):
        self.device, self.dtype = device, dtype
        # torch_dtype, as the cards pass it: transformers 4.57 leaves the Zipformer's own model in FP32 when given dtype.
        self.model = AutoModelForCTC.from_pretrained(folder, torch_dtype=dtype, trust_remote_code=True).to(device).eval()
        check_dtype(self.model, dtype)
        self.processor = AutoProcessor.from_pretrained(folder)

    def transcribe(self, samples, language):
        audio = np.pad(samples, pad_width=int(0.5 * SAMPLE_RATE))
        values = self.processor(audio, return_tensors="pt", sampling_rate=SAMPLE_RATE).input_values.to(self.device).to(self.dtype)
        logits = self.model(values).logits.cpu()
        ids = torch.argmax(logits, dim=-1)[0]
        return self.processor.decode(ids, skip_special_tokens=True).removeprefix("▁"), False


class Whisper:
    steers = True

    def __init__(self, folder, device, dtype, instruction):
        self.device, self.dtype = device, dtype
        self.model = WhisperForConditionalGeneration.from_pretrained(folder, dtype=dtype).to(device).eval()
        check_dtype(self.model, dtype)
        self.processor = AutoProcessor.from_pretrained(folder)
        self.languages = [token.strip("<|>") for token in self.model.generation_config.lang_to_id]

    def transcribe(self, samples, language):
        features = self.processor(samples, sampling_rate=SAMPLE_RATE, return_tensors="pt").input_features.to(self.device, self.dtype)
        ids = self.model.generate(features, language=language, task="transcribe")
        text = self.processor.batch_decode(ids, skip_special_tokens=True)[0]
        return text, ids.shape[-1] >= self.model.generation_config.max_length


class Moonshine:
    languages = ["ja"]
    steers = False

    def __init__(self, folder, device, dtype, instruction):
        self.device, self.dtype = device, dtype
        self.model = MoonshineForConditionalGeneration.from_pretrained(folder, dtype=dtype).to(device).eval()
        check_dtype(self.model, dtype)
        self.processor = AutoProcessor.from_pretrained(folder)

    def transcribe(self, samples, language):
        inputs = self.processor(samples, return_tensors="pt", sampling_rate=SAMPLE_RATE).to(self.device, self.dtype)
        limit = int((inputs.attention_mask.sum(dim=-1) * 13 / SAMPLE_RATE).max().item())
        ids = self.model.generate(**inputs, max_length=limit)
        return self.processor.decode(ids[0], skip_special_tokens=True), ids.shape[-1] >= limit


class GraniteSpeech:
    steers = True
    # The languages Granite Speech 5.0's card names for transcription, by the names its instruction gives them.
    names = {"en": "English", "fr": "French", "de": "German", "es": "Spanish", "pt": "Portuguese", "ja": "Japanese"}
    languages = list(names)
    max_new_tokens = 200

    def __init__(self, folder, device, dtype, instruction):
        if not instruction or "<language>" not in instruction:
            raise RuntimeError("Granite Speech is told the language in its instruction, which needs --instruction with <language>")
        self.device, self.instruction = device, instruction
        self.processor = AutoProcessor.from_pretrained(folder)
        self.model = AutoModelForSpeechSeq2Seq.from_pretrained(folder, device_map=device, dtype=dtype).eval()
        check_dtype(self.model, dtype)

    def transcribe(self, samples, language):
        if language is None:
            raise RequestError("invalid_argument", "language", "Granite Speech is told the language in its instruction")
        tokenizer = self.processor.tokenizer
        chat = [{"role": "user", "content": "<|audio|>" + self.instruction.replace("<language>", self.names[language])}]
        prompt = tokenizer.apply_chat_template(chat, tokenize=False, add_generation_prompt=True)
        inputs = self.processor(prompt, torch.from_numpy(samples)[None], device=self.device, return_tensors="pt").to(self.device)
        out = self.model.generate(**inputs, max_new_tokens=self.max_new_tokens, do_sample=False, num_beams=1)
        new = out[0, inputs["input_ids"].shape[-1]:]
        text = tokenizer.batch_decode(new.unsqueeze(0), add_special_tokens=False, skip_special_tokens=True)[0]
        return text, new.shape[-1] >= self.max_new_tokens


class CohereAsr:
    steers = True
    languages = ["ar", "de", "el", "en", "es", "fr", "it", "ja", "ko", "nl", "pl", "pt", "vi", "zh"]
    max_new_tokens = 256

    def __init__(self, folder, device, dtype, instruction):
        # Imported here: transformers 4.57, in which the transformers 4 adapter runs this worker, has no such class.
        from transformers import CohereAsrForConditionalGeneration
        self.processor = AutoProcessor.from_pretrained(folder)
        self.model = CohereAsrForConditionalGeneration.from_pretrained(folder, device_map=device, dtype=dtype).eval()
        check_dtype(self.model, dtype)

    def transcribe(self, samples, language):
        if language is None:
            raise RequestError("invalid_argument", "language", "Cohere Transcribe is told the language of every request")
        inputs = self.processor(samples, sampling_rate=SAMPLE_RATE, return_tensors="pt", language=language)
        inputs.to(self.model.device, dtype=self.model.dtype)
        out = self.model.generate(**inputs, max_new_tokens=self.max_new_tokens)
        text = self.processor.decode(out, skip_special_tokens=True)
        if isinstance(text, list):
            [text] = text
        return text, out.shape[-1] - 1 >= self.max_new_tokens


class VoxtralRealtime:
    steers = False
    # The languages Voxtral Mini 4B Realtime 2602's card lists.
    languages = ["en", "fr", "es", "de", "ru", "zh", "ja", "it", "pt", "nl", "ar", "hi", "ko"]

    def __init__(self, folder, device, dtype, instruction):
        # Imported here: transformers 4.57, in which the transformers 4 adapter runs this worker, has no such class.
        from transformers import VoxtralRealtimeForConditionalGeneration
        self.processor = AutoProcessor.from_pretrained(folder)
        self.model = VoxtralRealtimeForConditionalGeneration.from_pretrained(folder, device_map=device, dtype=dtype).eval()
        check_dtype(self.model, dtype)

    def transcribe(self, samples, language):
        inputs = self.processor(samples, return_tensors="pt").to(self.model.device, dtype=self.model.dtype)
        # generate() writes one token for each frame of the audio and its delay and stops there, the audio's end, so that
        # no limit of new tokens cuts a text short.
        out = self.model.generate(**inputs)
        return self.processor.batch_decode(out, skip_special_tokens=True)[0], False


RECIPES = {
    "reazonspeech-ctc": ReazonSpeechCtc,
    "whisper": Whisper,
    "moonshine": Moonshine,
    "granite-speech": GraniteSpeech,
    "cohere-asr": CohereAsr,
    "voxtral-realtime": VoxtralRealtime,
}


def model_info(recognizer, recipe, device):
    return {
        "architecture": recipe,
        "task": "recognition",
        "sample_rate": SAMPLE_RATE,
        "languages": recognizer.languages,
        "options": [{"name": "language", "type": "string", "required": False, "steers": recognizer.steers}],
        "device": device,
    }


def check_members(request, taken):
    """Refuses a member the request's type does not have, and an option of the vocabulary the adapter does not take."""
    for name, value in request.items():
        if name in ("type", "id") or name in taken or value is None:
            continue
        if name in VOCABULARY:
            raise RequestError("unsupported", name, f"the transformers adapter takes no {name}")
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
    # Every recipe gives the samples to its feature extractor as audio at 16 kHz, which none of them resamples.
    if rate != SAMPLE_RATE:
        raise RequestError("invalid_argument", "sample_rate", f"the model hears {SAMPLE_RATE} Hz audio, not {rate} Hz")
    tag = request.get("language")
    language = None
    if tag is not None:
        if not isinstance(tag, str) or tag.split("-")[0].lower() not in recognizer.languages:
            raise RequestError("out_of_range", "language", f"the model does not recognize {tag}; it recognizes {', '.join(recognizer.languages)}")
        language = tag.split("-")[0].lower() if recognizer.steers else None
    if not pieces:
        raise RequestError("invalid_argument", "pcm", "a recognition needs audio")
    samples = np.concatenate(pieces).astype(np.float32) / 32768
    text, limited = recognizer.transcribe(samples, language)
    send({"type": "end", "id": request["id"], "text": text, "stop": "model_limit" if limited else "complete"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--recipe", required=True, choices=sorted(RECIPES))
    parser.add_argument("--dtype", required=True, choices=sorted(DTYPES))
    parser.add_argument("--device", required=True)
    parser.add_argument("--instruction")
    args = parser.parse_args()

    try:
        torch.set_grad_enabled(False)
        version = importlib.metadata.version("transformers")
        check_device(args.device)
        recognizer = RECIPES[args.recipe](args.model, args.device, DTYPES[args.dtype], args.instruction)
    except Exception as error:
        traceback.print_exc()
        send({"type": "fatal", "error": {"code": "model_file", "option": None, "message": str(error)}})
        return 1
    send({"type": "ready", "protocol": 3, "version": version, "model": model_info(recognizer, args.recipe, args.device)})

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
                send({"type": "end", "id": rid, "model": model_info(recognizer, args.recipe, args.device)})
            else:
                raise RequestError("unsupported", "type", f"the transformers adapter takes no {kind}")
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
