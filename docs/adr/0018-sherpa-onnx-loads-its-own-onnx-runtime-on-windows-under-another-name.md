# sherpa-onnx loads its own ONNX Runtime on Windows under another name

Windows 11 keeps Windows ML's ONNX Runtime 1.17 as `System32\onnxruntime.dll`, and a process that loads sherpa-onnx's
addon gets that copy in place of the 1.28.2 beside the addon. The addon and `sherpa-onnx-c-api.dll` still come from
their own folder. sherpa-onnx then asks for an API version that 1.17 does not have, and Node exits with an access
violation; neither the VAD nor speaker embeddings can run. When the bench unpacks the pinned tarball on Windows, it
renames the bundled `onnxruntime.dll` to `sherpa-ort.dll` and rewrites the name `sherpa-onnx-c-api.dll` imports to
match. Windows has no DLL of that name, so it takes the one beside the addon.

## Rejected

- **Loading the bundled DLL first.** Node frees a DLL that is not an addon right after loading it. Adding a DLL
  directory, as `os.add_dll_directory` does in the workaround of k2-fsa/sherpa-onnx#3059, needs a native call.
- **Putting the folder on the PATH.** Windows searches System32 before the PATH.
- **sherpa-onnx's WebAssembly build.** Its VAD and embeddings would differ from those of the runs made so far, and
  it is slower.
- **Copying the DLL beside node.exe**, which writes into Node's installation.

## Measured

2026-10-03, on the Windows test machine (Windows 11 build 26200), sherpa-onnx 1.13.8:

- Before the change, the process held `C:\WINDOWS\SYSTEM32\onnxruntime.dll` 1.17 after loading the addon, and
  `asr --set common-voice` stopped with "The requested API version [28] is not available, only API versions [1, 17]
  are supported in this build" and exit code -1073741819.
- After the change, it held `sherpa-ort.dll` 1.28.2 from the addon's folder, and a VAD ran.
- The rewrite changes 14 bytes of `sherpa-onnx-c-api.dll`, which imports nothing else of the archive.

## Known limits

- CI never loads sherpa-onnx, since tests do not download, and GitHub's Windows image may lack Windows ML's copy; only
  a run on such a machine shows the failure.
- A later sherpa-onnx has to be checked again. The rename stops the unpacking if `sherpa-onnx-c-api.dll` no longer
  imports `onnxruntime.dll`.
