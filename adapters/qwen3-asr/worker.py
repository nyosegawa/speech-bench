"""Qwen3-ASR as the official code runs it, behind speech.cpp's worker protocol 3, so that the bench measures the
original the way it measures the port.

usage: worker.py --model FOLDER --device mps|cuda

FOLDER holds the checkpoint as Qwen publishes it: its configuration, tokenizer, chat template, generation and
preprocessor configurations, and weights. The model is transformers' own Qwen3ASRForConditionalGeneration with that
configuration and those weights in bfloat16, the dtype of the checkpoint and of qwen-asr's examples. Its encoder
attends within windows of 8 s on every attention path, as qwen-asr's FlashAttention 2 path and its vLLM backend do;
qwen-asr's transformers backend on any other attention attends over the whole utterance, and FlashAttention 2 runs on
neither an Apple GPU nor an RTX 2080. What transformers does not do comes from qwen-asr's own code, as its transcribe()
runs it: the normalization of the audio, the split of audio over 1200 s, the prompt with its system turn and the
language, and the parse of the output. Decoding is greedy with the checkpoint's generation_config.json and at most
4096 new tokens, the default of qwen-asr's vLLM backend.

A recognition request is its audio in `chunk` messages of base64 16-bit PCM numbered from 0, then `transcribe` with
`sample_rate` and, optionally, `language` as a BCP 47 tag, which qwen-asr writes into the prompt as the start of the
answer, `language Japanese<asr_text>`. Without it the model names the language itself.
"""

import argparse
import base64
import importlib.metadata
import importlib.util
import json
import os
import sys
import traceback

# The protocol keeps the stdout the bench gave; descriptor 1 then writes to stderr, so whatever a package prints
# to stdout while it loads or runs lands in the log instead of between two messages.
PROTOCOL = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)
# Python writes a pipe in the ANSI code page on Windows; the log is UTF-8 on every system.
sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
sys.stdout = sys.stderr

import numpy as np  # noqa: E402
import torch  # noqa: E402
from transformers import (AutoTokenizer, GenerationConfig, Qwen3ASRConfig, Qwen3ASRFeatureExtractor,  # noqa: E402
                          Qwen3ASRForConditionalGeneration)
from transformers.models.qwen3_asr.modeling_qwen3_asr import _get_feat_extract_output_lengths  # noqa: E402

# The options of speech.cpp's vocabulary, of which this adapter takes those in TRANSCRIBE besides `type`, `id` and
# `sample_rate`.
VOCABULARY = {"language", "prompt", "timestamps", "decoding", "max_seconds"}
TRANSCRIBE = {"language"}
MAX_NEW_TOKENS = 4096
DTYPE = torch.bfloat16

# qwen-asr's languages by the BCP 47 tag the bench names them with.
LANGUAGES = {
    "zh": "Chinese", "en": "English", "yue": "Cantonese", "ar": "Arabic", "de": "German", "fr": "French",
    "es": "Spanish", "pt": "Portuguese", "id": "Indonesian", "it": "Italian", "ko": "Korean", "ru": "Russian",
    "th": "Thai", "vi": "Vietnamese", "ja": "Japanese", "tr": "Turkish", "hi": "Hindi", "ms": "Malay", "nl": "Dutch",
    "sv": "Swedish", "da": "Danish", "fi": "Finnish", "pl": "Polish", "cs": "Czech", "fil": "Filipino", "fa": "Persian",
    "el": "Greek", "ro": "Romanian", "hu": "Hungarian", "mk": "Macedonian",
}

# The checkpoint names its weights as qwen-asr's model does, under `thinker.`; transformers' implementation names the
# same tensors otherwise.
KEY_MAPPING = {
    r"^thinker\.audio_tower\.proj1\.": "model.multi_modal_projector.linear_1.",
    r"^thinker\.audio_tower\.proj2\.": "model.multi_modal_projector.linear_2.",
    r"^thinker\.audio_tower\.": "model.audio_tower.",
    r"^thinker\.model\.": "model.language_model.",
    r"^thinker\.lm_head\.": "lm_head.",
}
AUDIO_KEYS = ("num_mel_bins", "encoder_layers", "encoder_attention_heads", "encoder_ffn_dim", "d_model",
              "activation_function", "scale_embedding", "n_window", "n_window_infer", "output_dim", "downsample_hidden_size")
TEXT_KEYS = ("vocab_size", "hidden_size", "intermediate_size", "num_hidden_layers", "num_attention_heads",
             "num_key_value_heads", "head_dim", "hidden_act", "max_position_embeddings", "rms_norm_eps", "attention_bias",
             "tie_word_embeddings")


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


def qwen_asr_utils():
    """qwen-asr's inference/utils.py, loaded from its file: importing the package runs its __init__, which imports
    qwen-asr's own copy of the model, written for transformers 4.57.6 and failing on 5.18."""
    package = importlib.util.find_spec("qwen_asr").submodule_search_locations[0]
    spec = importlib.util.spec_from_file_location("qwen_asr_inference_utils", os.path.join(package, "inference", "utils.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def load(folder, device, sample_rate):
    """transformers' model with the checkpoint's configuration and weights, its tokenizer, chat template, generation
    configuration and feature extractor."""
    with open(os.path.join(folder, "config.json"), encoding="utf-8") as f:
        thinker = json.load(f)["thinker_config"]
    audio, text = thinker["audio_config"], thinker["text_config"]
    # transformers' text model runs plain RoPE where qwen-asr's runs interleaved M-RoPE; with the same position in all
    # three sections, as get_rope_index() gives every token of an audio-and-text prompt, the two are the same.
    if sum(text["rope_scaling"]["mrope_section"]) * 2 != text["head_dim"]:
        raise RuntimeError("the checkpoint's M-RoPE sections do not cover the head, so plain RoPE would differ from it")
    config = Qwen3ASRConfig(
        audio_config={"model_type": "qwen3_asr_encoder", **{key: audio[key] for key in AUDIO_KEYS},
                      "max_position_embeddings": audio["max_source_positions"]},
        text_config={"model_type": "qwen3", **{key: text[key] for key in TEXT_KEYS},
                     "rope_parameters": {"rope_type": "default", "rope_theta": text["rope_theta"]}},
        audio_token_id=thinker["audio_token_id"],
        tie_word_embeddings=text["tie_word_embeddings"],
    )
    model, info = Qwen3ASRForConditionalGeneration.from_pretrained(
        folder, config=config, key_mapping=KEY_MAPPING, dtype=DTYPE, device_map=device, output_loading_info=True)
    # from_pretrained() only warns of a weight the checkpoint lacks or holds beyond the model's.
    faults = {kind: names for kind, names in info.items() if names}
    if faults:
        raise RuntimeError(f"the checkpoint's weights do not match transformers' Qwen3-ASR: {faults}")
    model.eval()

    with open(os.path.join(folder, "preprocessor_config.json"), encoding="utf-8") as f:
        preprocessor = json.load(f)
    extractor = Qwen3ASRFeatureExtractor(
        feature_size=preprocessor["feature_size"], sampling_rate=sample_rate,
        hop_length=preprocessor["hop_length"], n_fft=preprocessor["n_fft"], padding_value=preprocessor["padding_value"],
        dither=preprocessor["dither"], n_window=audio["n_window"])
    tokenizer = AutoTokenizer.from_pretrained(folder)
    with open(os.path.join(folder, "chat_template.json"), encoding="utf-8") as f:
        template = json.load(f)["chat_template"]
    generation = GenerationConfig.from_pretrained(folder)
    if generation.do_sample:
        raise RuntimeError("the checkpoint's generation_config.json samples, and the adapter decodes greedily as qwen-asr does")
    generation.update(max_new_tokens=MAX_NEW_TOKENS)
    return model, extractor, tokenizer, template, generation


class Recognizer:
    def __init__(self, folder, device):
        self.utils = qwen_asr_utils()
        self.model, self.extractor, self.tokenizer, self.template, self.generation = load(folder, device, self.utils.SAMPLE_RATE)
        self.device = device

    def prompt(self, language):
        """The prompt as qwen-asr's _build_text_prompt() writes it without a context: the chat template with an empty
        system turn, the user's audio and the generation prompt, and a language as the start of the answer."""
        messages = [{"role": "system", "content": ""}, {"role": "user", "content": [{"type": "audio", "audio": ""}]}]
        text = self.tokenizer.apply_chat_template(messages, chat_template=self.template, add_generation_prompt=True, tokenize=False)
        return text + f"language {language}<asr_text>" if language else text

    def part(self, samples, language):
        """One part of at most 1200 s: its raw output and whether the decoding reached the most new tokens."""
        out = self.extractor(samples, sampling_rate=self.utils.SAMPLE_RATE, padding=True, truncation=False,
                             return_attention_mask=True, return_tensors="pt")
        features, mask = out["input_features"], out["attention_mask"]
        audio_tokens = int(_get_feat_extract_output_lengths(mask.sum(-1), self.extractor.n_window)[0])
        pad = self.tokenizer.audio_token
        # qwen-asr's processor expands the audio token to one per encoder output (Qwen3ASRProcessor.__call__).
        ids = torch.tensor([self.tokenizer(self.prompt(language).replace(pad, pad * audio_tokens, 1))["input_ids"]], device=self.device)
        generated = self.model.generate(
            input_ids=ids, attention_mask=torch.ones_like(ids), input_features=features.to(self.device, DTYPE),
            input_features_mask=mask.to(self.device), generation_config=self.generation)[0, ids.shape[1]:]
        limited = int(generated[-1]) not in self.generation.eos_token_id
        return self.tokenizer.decode(generated, skip_special_tokens=True, clean_up_tokenization_spaces=False), limited

    def transcribe(self, samples, rate, language):
        """The text of the audio as qwen-asr's transcribe() gives it, and whether a part stopped at the most new tokens."""
        [audio] = self.utils.normalize_audios([(samples, rate)])
        texts, limited = [], False
        for part, _ in self.utils.split_audio_into_chunks(wav=audio, sr=self.utils.SAMPLE_RATE, max_chunk_sec=self.utils.MAX_ASR_INPUT_SECONDS):
            raw, stopped = self.part(part, language)
            texts.append(self.utils.parse_asr_output(raw, user_language=language)[1])
            limited = limited or stopped
        return "".join(texts), limited


def model_info(device):
    return {
        "architecture": "qwen3-asr",
        "task": "recognition",
        "sample_rate": 16000,
        "languages": list(LANGUAGES),
        "options": [{"name": "language", "type": "string", "required": False, "steers": True}],
        "device": device,
    }


def check_members(request, taken):
    """Refuses a member the request's type does not have, and an option of the vocabulary the adapter does not take."""
    for name, value in request.items():
        if name in ("type", "id") or name in taken or value is None:
            continue
        if name in VOCABULARY:
            raise RequestError("unsupported", name, f"the Qwen3-ASR adapter takes no {name}")
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
    language = None
    if tag is not None:
        if not isinstance(tag, str) or tag.split("-")[0].lower() not in LANGUAGES:
            raise RequestError("out_of_range", "language", f"Qwen3-ASR does not recognize {tag}; it recognizes {', '.join(LANGUAGES)}")
        language = LANGUAGES[tag.split("-")[0].lower()]
    if not pieces:
        raise RequestError("invalid_argument", "pcm", "a recognition needs audio")
    samples = np.concatenate(pieces).astype(np.float32) / 32768
    text, limited = recognizer.transcribe(samples, rate, language)
    send({"type": "end", "id": request["id"], "text": text, "stop": "model_limit" if limited else "complete"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", required=True)
    args = parser.parse_args()

    try:
        torch.set_grad_enabled(False)
        version = importlib.metadata.version("transformers")
        check_device(args.device)
        recognizer = Recognizer(args.model, args.device)
    except Exception as error:
        traceback.print_exc()
        send({"type": "fatal", "error": {"code": "model_file", "option": None, "message": str(error)}})
        return 1
    send({"type": "ready", "protocol": 3, "version": version, "model": model_info(args.device)})

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
                send({"type": "end", "id": rid, "model": model_info(args.device)})
            else:
                raise RequestError("unsupported", "type", f"the Qwen3-ASR adapter takes no {kind}")
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
