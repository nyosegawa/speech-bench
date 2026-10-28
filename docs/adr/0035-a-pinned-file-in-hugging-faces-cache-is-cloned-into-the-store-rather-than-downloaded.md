# A pinned file in Hugging Face's cache is cloned into the store rather than downloaded

A pinned Hugging Face file that the store does not hold is first looked for in Hugging Face's own cache, where `hf
download` and Hugging Face's libraries keep what they fetch: `HF_HUB_CACHE`, else `hub` in `HF_HOME`, else
`~/.cache/huggingface/hub`, at `models--<org>--<name>/snapshots/<revision>/<file>`. A file found there with the pinned
size is hashed, and taken only when its sha256 is the pinned one; it is then copied into the store under a temporary
name and renamed into place, as a download is. Any other size is passed over and the file is downloaded; the pinned
size with other bytes stops the run, naming the file in the cache.

The copy is a clone where the file system makes one, which takes no room until one of the two changes: `cp -c` on a
Mac, since Node's `COPYFILE_FICLONE` copied every byte of a 3.5 GB file on APFS (Node 22.23, 2026-10-29), and
`COPYFILE_FICLONE` elsewhere, which clones on a Linux file system that can and copies on any other. The store keeps
its own file, so that removing it from either place leaves the other whole.

A checkpoint speech.cpp converts is fetched with `hf download` into that cache, and the bench converts the same
checkpoint for another runtime: Nemotron 3.5 Transcribe is 67.5 GB in one file, which a second download would take
again from the network and, without a clone, from the disk.

## Rejected

- **Reading the file in the cache where it is.** The cache is Hugging Face's to prune and to replace; a file the bench
  verified once could change under it, and every other file the bench reads is one it renamed into place itself.
- **A hard link.** It shares the file itself, so a change made through the cache would change the store's file.
- **Taking the cache's file by its name without hashing it.** A file there was written by another program, which the
  bench cannot vouch for; the 67.5 GB checkpoint of Nemotron 3.5 Transcribe hashed in under a minute on an Apple M5
  (2026-10-29).

## Known limits

- A clone holds all of the file's room once the cache's copy is removed: a checkpoint taken only to convert it is
  removed from the store after the conversion, by hand.
- Only a revision named by its commit is found, as every pinned file is: the cache keeps a snapshot per commit and maps
  a branch to its commit in `refs/`, which the bench does not read.
