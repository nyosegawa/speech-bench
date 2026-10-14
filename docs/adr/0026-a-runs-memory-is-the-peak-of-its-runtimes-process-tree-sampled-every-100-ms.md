# A run's memory is the peak of its runtime's process tree, sampled every 100 ms

Every recognition and synthesis run records the memory its runtime took, from before the runtime starts until it is
stopped: the process the engine starts and every process under it, such as uv and the Python an adapter runs. The
bench looks at the machine every 100 ms, a look that takes longer delaying the next, and keeps for each figure the
largest sum over the tree's processes in one look, so that two processes that peak at different times are not added
at their peaks. A run records two figures (result format 15): the peak resident memory and the peak GPU memory, with
what the GPU memory measures, and on a Mac a third (format 21), the peak of the two summed in one look. Old runs and a
run cut short record none, rather than zeros.

**macOS.** The resident memory is the RSS `ps` gives. The GPU memory, named GPU memory (Metal), is the part of each
process's physical footprint that `footprint` (shipped with macOS, no administrator rights needed) puts in categories
tagged `(graphics)`: `IOAccelerator (graphics)` and `Owned physical footprint (unmapped) (graphics)`, the buffers
Metal's driver allocated for the process, private or shared, once the GPU or the CPU has written them. RSS counts none
of them. A Mac's GPU shares the memory with the CPU, so the two figures are parts of one memory, not two memories:

- ggml gives Metal the weights from memory of its own (`untagged (VM_ALLOCATE)`, 1,158 MB for Qwen3-TTS 0.6B Q8_0 in
  speech.cpp), which counts as resident memory, not as GPU memory.
- llama.cpp maps its model file into memory; those pages count in RSS (llama-server held 9.4 GB of RSS with Qwen3-ASR
  1.7B) and not in the physical footprint (7.6 GB).
- A Metal buffer that is allocated and never written takes no memory and counts nowhere. Metal's own
  `currentAllocatedSize`, and the compute buffer sizes ggml reports, count what was allocated, so they can grow by
  hundreds of MB while no figure here moves; `/usr/bin/time -l`'s peak footprint behaves the same way, which is why it
  did not grow with speech.cpp's larger compute buffers.

A runtime's weights thus fall in one figure or the other by how it allocates them: ggml's runtimes hold them in
resident memory, PyTorch's MPS and MLX in GPU memory (Metal). Neither figure alone compares runtimes on a Mac, so a run
also records the peak of their sum in one look, which the report gives as Memory (RSS + Metal) and is the figure to
compare. A run made before format 21 has only the two peaks; the report gives their sum, written `≤`, as an upper
bound.

**Windows.** The resident memory is each process's working set and the GPU memory, named VRAM, its dedicated GPU
memory, both read from Windows' performance counters (`Process` and `GPU Process Memory`) by one PowerShell process
that reads both categories whole every 100 ms and writes a line of JSON per look. WDDM counts the dedicated memory of
every process whatever the API, so CUDA (the adapters) and Vulkan (the ggml runtimes) are measured alike, and a user
reads the counters without administrator rights. A machine on which no process held dedicated GPU memory in any look
has no discrete GPU, and records none. A Windows without the counters (before Windows 10 1709, or without a WDDM 2
driver) stops the run before it starts.

## Rejected

- **The physical footprint as the resident memory on macOS** (`proc_pid_rusage`, `/usr/bin/time -l`, Activity
  Monitor's Memory). It holds Metal's buffers, but leaves out a mapped model file, so llama.cpp would look gigabytes
  lighter than a runtime that reads its weights into memory.
- **GPU memory in use on the whole GPU**, from nvidia-smi on Windows or the IORegistry's `In use system memory` of
  the Mac's GPU. It counts every other program's memory, and other work shares the machines. nvidia-smi gives no
  memory per process under WDDM, only `[N/A]`.
- **The sum of the two peaks as a Mac run's memory.** They may come from different looks: a runtime that reads its
  weights into its own memory and then hands them to Metal would count them twice.
- **Each process's own peak** (`phys_footprint_peak`, which the kernel keeps). Added up over uv and Python, the peaks
  of different moments would be a sum no moment had.
- **typeperf or Get-Counter on Windows.** They sample once a second at the fastest.

## Measured

2026-10-13, Apple M5, macOS 26.2, a Swift program that allocates one Metal buffer and fills it with a blit, sampled as
a run is:

| Buffer | Filled | GPU memory (Metal) | Resident |
|---|---|---|---|
| none | | 0.000 GiB | 0.011 GiB |
| 1 GiB private | yes | 1.000 GiB | 0.015 GiB |
| 2 GiB private | yes | 2.000 GiB | 0.015 GiB |
| 2 GiB private | no | 0.000 GiB | 0.011 GiB |
| 1 GiB shared | yes | 1.036 GiB | 0.015 GiB |

Ten utterances of FLEURS ja-JP, Qwen3-ASR 0.6B: speech.cpp v0.8.2 Q8_0 1.08 GiB resident and 0.04 GiB of Metal,
llama.cpp b11246 Q8_0 1.76 and 0.05, the official implementation through MPS in BF16 2.34 and 4.98. A look came
every 100 ms with speech.cpp's worker and about every 210 ms with Qwen3-TTS's adapter, whose uv and Python `footprint`
read in 60 to 80 ms. Three sentences of Qwen3-TTS 0.6B in its adapter, twice each way and alternated, took 79 and
113 s without sampling and 91 and 82 s with it, on a machine whose CPUs other work kept 90% busy: the sampling is
within that noise.

2026-10-13, Apple M5, 200 utterances of Common Voice 8 ja-JP, resident and Metal memory: Qwen3-ASR 0.6B in
speech.cpp 0.8.4 Q8_0 0.94 and 0.04 GiB, in the official implementation through MPS in BF16 3.23 and 3.42 GiB;
Qwen3-ASR 1.7B 2.18 and 0.04 GiB against 5.57 and 6.63 GiB. By resident memory alone the official implementation
holds 3.4 and 2.6 times as much as speech.cpp, while the sums of the two peaks are 6.64 against 0.98 GiB and 12.20
against 2.23 GiB.
