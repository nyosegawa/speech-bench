# A Linux machine is measured with an NVIDIA GPU, whose whole memory in use counts as the runtime's

Some models do not fit the bench's own machines, and some GPUs are not among them: Fish Audio Drama 3's official
implementation computes its FP8 experts with CUDA kernels and needs a GPU of 80 GB, and speech.cpp is to be measured on
RTX 50-series GPUs. Both run on machines rented in the cloud, which are Linux x64 containers with NVIDIA GPUs. The bench
runs there as it runs on a Mac or a Windows machine, so that a model is timed, its memory read and its speech heard by
the same code, on the machine that runs it (result format 22):

- **The machine.** The system is the container's image from `/etc/os-release` (`PRETTY_NAME`) with the kernel of the
  machine it runs on, the GPUs and their drivers are `nvidia-smi --query-gpu=name,driver_version`'s, and a machine
  without nvidia-smi stops the run. Linux records no power source, and its load average as a Mac does.
- **The runtimes.** speech.cpp and llama.cpp run their Vulkan builds, which their releases publish for Linux x64, and
  sherpa-onnx its npm package for Linux x64. A runtime without a Linux archive (CrispASR, NeMo-Speech.cpp, audio.cpp,
  mlx-audio) stops the run, naming the systems it runs on. An official implementation runs on CUDA with PyPI's
  PyTorch, which is a CUDA build on Linux, where its adapter's lock file includes Linux. The zip archives are unpacked
  with libarchive's `bsdtar`, as macOS's and Windows' `tar` are bsdtar, since GNU tar reads no zip.
- **The driver's Vulkan in a container.** NVIDIA's driver 580 loads `libEGL.so.1` when Vulkan starts, and without it
  its ICD gives the loader no `vkCreateInstance`, so the loader passes it over and finds no NVIDIA device, with a newer
  loader too: on a RunPod container of Ubuntu 22.04 with `graphics` among its driver capabilities, `speech devices`
  found the RTX 5080 only once `libegl1` was installed (2026-10-15).
- **The resident memory** is each process's RSS with its parent from `/proc/<pid>/stat`, read every 100 ms as `ps`
  is on a Mac, without a tool a slim image may lack.
- **The GPU memory** (`device`, reported as VRAM (whole GPU)) is the memory in use on all NVIDIA GPUs together, from
  `nvidia-smi --query-gpu=timestamp,index,memory.used -lms 100`, beyond the first reading, taken before the runtime
  starts. nvidia-smi gives memory per process only by the machine's pids, which a container's processes do not have,
  so the whole GPU stands for the runtime's processes; a measurement wants a machine nothing else uses, which a rented
  container is.
- **The GPU power** is read as on Windows, from the nvidia-smi on the `PATH`.
- **A cold load** is refused on Linux. A copy that no file cache holds needs `/proc/sys/vm/drop_caches`, or `O_DIRECT`
  writes that fail on a file whose size is not a multiple of the block, and a container gives no root for the first.

## Rejected

- **The memory of each process from `nvidia-smi --query-compute-apps=pid,used_memory`.** Its pids are the machine's,
  and none of them is a pid the bench sees inside its container.
- **Running the adapter in the cloud and the bench on the Mac, with the protocol carried over the network.** The time
  to first audio would hold the round trip across the Pacific, and no process the bench could look at would hold the
  model.
- **A runtime's CPU build where its Vulkan build finds no device.** The run would measure another backend than the one
  named, as no other system's run does; a container whose driver gives no Vulkan stops the run instead.
