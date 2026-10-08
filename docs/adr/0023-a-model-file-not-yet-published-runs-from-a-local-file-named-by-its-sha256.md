# A model file not yet published runs from a local file named by its sha256

speech.cpp makes the model files of its next release before they are on Hugging Face: the weight types it quantizes
(Q6_K, Q5_K, Q4_K) and the files of a new layout. Their accuracy and speed are compared with the released files before
they are published. `asr` and `tts` take `--model-file <file> --model-sha256 <hex>` with one model in `--models`: the
file runs in place of that catalog entry's one pinned file, and the rest of the entry stays as it is, its runtime, its
decoding or steps, its languages and whether it speaks like a reference. The file is checked against the sha256 each
time a run uses it, before the model is loaded, as a download is checked before it is renamed into place.

The run is kept under an id of its own, the entry's id with `-local-` and the first 12 digits of the sha256, and a
label that names the file, those digits and the entry, `local Qwen3-ASR-1.7B-Q6_K.gguf (sha256 3c5d2a8e41f0) as
qwen3-asr-1.7b-speech.cpp`, so that a file made again under its name is told apart on the pages too. The result
records the file as `{ source: 'local', file, bytes, sha256 }` (result format 14, where every published file has
`source: 'huggingface'`), without the path it was read from.

## Rejected

- **Catalog entries for the candidates, pinned by size and sha256 as converted files are (docs/adr/0021).** The
  candidates are many, three weight types of each of nine models and a new layout, and they are made again whenever
  the quantization changes before the release. Every change would be a commit to the catalog. A file that is
  published becomes an entry pinned on Hugging Face, as any other.
- **An environment variable.** It reaches every model a command runs, and `tts` also transcribes the speech with
  Qwen3-ASR in llama.cpp, whose files the candidate must not replace. A file belongs to one model of one command.
- **The sha256 read from the file without being given.** The same command could then measure other bytes from one run
  of a campaign to the next without anyone noticing, as a file made again keeps its name.
- **The entry's id and label kept, with the file recorded apart.** The listening page keeps the newest run of each
  model id and the neighbors page groups takes by it, so the runs of a local file would replace or join those of the
  published file, and the report and the pages show the label, which names the published weight type.

## Known limits

- The bench checks the file only by its sha256. That it is a file of the entry's model is left to whoever names it;
  the label names the file, so a file of another model shows as what it is.
