# A run records the state of its machine and the power of an NVIDIA GPU

A run records, beside what it measured, what could make its figures disagree with another run's (result format 16):

- **Each GPU with its driver's version.** On Windows, Win32_VideoController's `DriverVersion`, which every vendor's
  driver gives in one form. A Mac's Metal driver comes with macOS, so the system is recorded with its build
  (`macOS 26.2 (25C56)`) and the GPU's driver as none.
- **A Mac's power**: whether it draws from the power adapter or its battery, and whether Low Power Mode is on, from
  `pmset`; either slows it. None on Windows, which the bench runs on desktops.
- **How busy the machine was** over the second before the runtime started and the second after it stopped: the share
  of the CPUs' time spent working, from Node's `os.cpus()` on both systems, and on a Mac the load average of the last
  minute. Windows keeps no load average.
- **The power of the NVIDIA GPUs** on Windows, every 100 ms from `nvidia-smi --query-gpu=timestamp,index,power.draw
  -lms 100`, the GPUs of one timestamp added up, as the peak and the mean from starting the runtime to stopping it.
  nvidia-smi is the one in `System32`, which the driver installs; a machine with an NVIDIA GPU and without it, or a
  GPU that reads no power, stops the run. A machine without an NVIDIA GPU records none, and a Mac too: its GPU's
  power is read only by `powermetrics`, which needs administrator rights.

The first request after loading, which pays for the GPU's first use, was already recorded as the warm-up and is
reported apart from the rest as First request. The commit of a build of speech.cpp, the sha256 of every model file and
the version of every runtime were already recorded.

## Rejected

- **The power of the process alone.** No tool reads it; the GPU's power is the whole GPU's, so a measurement wants a
  machine with nothing else on its GPU, which the load before and after helps check.
- **Windows' CPU time from its performance counters.** `os.cpus()` gives the same on both systems with no tool, and
  English counter names are not found on a Windows in another language through `Get-Counter`.
- **Waiting for the machine to be idle before a run.** A run that waits would hide how busy the machine was, where the
  record shows it.
