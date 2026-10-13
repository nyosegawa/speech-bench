# A cold load reads copies of the model files that no file cache holds

A run made with `--cold-load` gives its runtime fresh copies of the model files in place of the files themselves, and
records the load as cold (result format 18), so that the load time is that of a model read from the disk, as a user
meets it after a restart, and not of one the system had kept in memory from the run before. The copies go to
`cold/` of the data folder, on the volume of the model files, keeping each file's place below the folder the files
share, since an adapter reads its model as a folder; they are removed once the runtime has stopped. An Irodori-TTS
voice file is made from the model file before the copy, so that making it does not read the copy into the cache.

- **macOS**: an APFS clone, `cp -c`. It writes no data, so it takes no time and no space, and it is a new file to the
  cache. On an Apple M5 (2026-10-13), a 2.29 GB GGUF read in 0.32 s the first time and 0.18 s the second; its clone read
  in 0.32 s the first time and 0.18 s the second.
- **Windows**: `robocopy /J`, which copies without the cache, so that the copy is not in it either. NTFS has no clone,
  and the copy takes as long as the file takes to write.

A file outside the data folder's volume cannot be cloned, and stops the run.

## Rejected

- **Emptying the file cache**: `purge` on macOS and the standby list on Windows need administrator rights, and they
  empty every other program's cache too.
- **Reading the files once without the cache** (`F_NOCACHE`, `FILE_FLAG_NO_BUFFERING`): the runtime reads the file
  itself, through the cache.
- **A plain copy**: it passes through the cache as it is written, so the copy is warm.
