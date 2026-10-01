import fs from 'node:fs'
import path from 'node:path'
import { downloadVerified, extractArchive } from './download.ts'
import { runtimesDir } from './paths.ts'
import { platformKey, type PlatformKey } from './platform.ts'

/** One release archive of a runtime and the executable inside it, as a path relative to the unpacked folder. */
interface RuntimeAsset {
  url: string
  sha256: string
  executable: string
}

export interface RuntimeSpec {
  id: string
  version: string
  assets: Record<PlatformKey, RuntimeAsset>
}

/** The llama.cpp release Qwen3-ASR is measured in. */
export const LLAMA_CPP: RuntimeSpec = {
  id: 'llama.cpp',
  version: 'b11246',
  assets: {
    'darwin-arm64': {
      url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11246/llama-b11246-bin-macos-arm64.tar.gz',
      sha256: 'b463a0a8b0572e25b5b97647202b7a898a29120bcf3f19aa5a8db4b997f16708',
      executable: 'llama-b11246/llama-server'
    },
    'win32-x64': {
      url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11246/llama-b11246-bin-win-vulkan-x64.zip',
      sha256: 'a6195668eeaadfa80e9c2ec27875e35125a1b44e94d17e72c8725b7725e5ccd3',
      executable: 'llama-server.exe'
    }
  }
}

/**
 * CrispASR's prebuilt binaries: Metal on the Mac, Vulkan on Windows. The macOS build requires macOS 26.
 */
export const CRISPASR: RuntimeSpec = {
  id: 'crispasr',
  version: 'v0.8.38',
  assets: {
    'darwin-arm64': {
      url: 'https://github.com/CrispStrobe/CrispASR/releases/download/v0.8.38/crispasr-macos.tar.gz',
      sha256: '5a94e4c0d42828f13d9e3123d91dd3ef9871e33e405c3b2e95c5627bbeb24ae1',
      executable: 'crispasr-macos/crispasr'
    },
    'win32-x64': {
      url: 'https://github.com/CrispStrobe/CrispASR/releases/download/v0.8.38/crispasr-windows-x86_64-vulkan.zip',
      sha256: 'cae3f60051379eebf64330accc7c706b65eba169705b85b90d3fcd49f049fcab',
      executable: 'crispasr-windows-x86_64-vulkan/crispasr.exe'
    }
  }
}

const SPEECH_CPP_RELEASE = 'https://github.com/nyosegawa/speech.cpp/releases/download/v0.3.0'

/** speech.cpp's worker, which runs Qwen3-TTS and Irodori-TTS and speaks the worker protocol. */
export const SPEECH_CPP: RuntimeSpec = {
  id: 'speech.cpp',
  version: 'v0.3.0',
  assets: {
    'darwin-arm64': {
      url: `${SPEECH_CPP_RELEASE}/speech-worker-v0.3.0-macos-arm64-metal.zip`,
      sha256: '004a7f6ffc0f07ee273b75e622eb082df62ac3fb9df3c3dcd24f20a57c4f62e9',
      executable: 'speech-worker'
    },
    'win32-x64': {
      url: `${SPEECH_CPP_RELEASE}/speech-worker-v0.3.0-windows-x64-vulkan.zip`,
      sha256: 'f8d868eeb12b08e8ddc8e06d3823da58d63d9f12afd1ac300a852b3a7b62ada7',
      executable: 'speech-worker.exe'
    }
  }
}

/** speech.cpp's command-line tools, of which the bench uses `irodori-tts` to make Irodori-TTS voice files. */
export const SPEECH_CPP_TOOLS: RuntimeSpec = {
  id: 'speech.cpp-tools',
  version: 'v0.3.0',
  assets: {
    'darwin-arm64': {
      url: `${SPEECH_CPP_RELEASE}/speech-cpp-tools-v0.3.0-macos-arm64-metal.zip`,
      sha256: '067e01bb6fe10b0ead1c04982da9fdc0ffed27fae9f245d77d5e9e057030ba0d',
      executable: 'irodori-tts'
    },
    'win32-x64': {
      url: `${SPEECH_CPP_RELEASE}/speech-cpp-tools-v0.3.0-windows-x64-vulkan.zip`,
      sha256: '0ad6efebd29cec9daacbfda4b0d99e3bd1eac777737b558478cbfed77be7a544',
      executable: 'irodori-tts.exe'
    }
  }
}

/** audio.cpp's prebuilt server: Metal on the Mac, Vulkan on Windows. It runs Irodori-TTS for measuring only. */
export const AUDIO_CPP: RuntimeSpec = {
  id: 'audio.cpp',
  version: 'v0.8.2-audio8-perf-hotfix',
  assets: {
    'darwin-arm64': {
      url: 'https://github.com/0xShug0/audio.cpp/releases/download/v0.8.2-audio8-perf-hotfix/audio-v0.8.2-audio8-perf-hotfix-bin-macos-arm64-metal.tar.gz',
      sha256: '295c6b77476a9daa455025efe7931d89788e410eb4859d6a93a820c86d8afa26',
      executable: 'audiocpp_server'
    },
    'win32-x64': {
      url: 'https://github.com/0xShug0/audio.cpp/releases/download/v0.8.2-audio8-perf-hotfix/audio-v0.8.2-audio8-perf-hotfix-bin-windows-x64-vulkan.zip',
      sha256: '3426ed753f7c720221ce20d27a4c134b6e7595f20955d6a2b9d10e7f47cfec2b',
      executable: 'audiocpp_server.exe'
    }
  }
}

/**
 * sherpa-onnx's Node addon with ONNX Runtime beside it, the prebuilt npm packages taken as archives so that
 * the bench keeps no runtime dependency. It computes speaker embeddings in this process: sherpa-onnx ships no
 * command that prints an embedding for a file (v1.13.8). The hashes are of the npm tarballs, whose sha512
 * matched the registry's integrity on 2026-10-01.
 */
export const SHERPA_ONNX: RuntimeSpec = {
  id: 'sherpa-onnx',
  version: '1.13.8',
  assets: {
    'darwin-arm64': {
      url: 'https://registry.npmjs.org/sherpa-onnx-darwin-arm64/-/sherpa-onnx-darwin-arm64-1.13.8.tgz',
      sha256: 'e1abc1d9676478996574de922e55714d80b4500b860bc4e7349aa01cd0ea4929',
      executable: 'package/sherpa-onnx.node'
    },
    'win32-x64': {
      url: 'https://registry.npmjs.org/sherpa-onnx-win-x64/-/sherpa-onnx-win-x64-1.13.8.tgz',
      sha256: 'fe522f02a5c113c2567a43982107ef41ae517f9a431931e90731e7e4d4341073',
      executable: 'package/sherpa-onnx.node'
    }
  }
}

/**
 * The executable of the runtime on this machine, downloading and unpacking its release first when it is not
 * there. The unpacked folder is renamed into place only once complete, so a folder that exists is whole.
 */
export async function ensureRuntime(spec: RuntimeSpec): Promise<string> {
  const asset = spec.assets[platformKey()]
  const folder = path.join(runtimesDir(), `${spec.id}-${spec.version}`)
  const executable = path.join(folder, asset.executable)
  if (fs.existsSync(folder)) {
    if (!fs.existsSync(executable)) throw new Error(`${folder} has no ${asset.executable}; remove the folder to unpack the release again`)
    return executable
  }
  process.stderr.write(`  downloading ${spec.id} ${spec.version}\n`)
  // The work folder sits beside the target, because a rename across volumes fails.
  fs.mkdirSync(runtimesDir(), { recursive: true })
  const work = fs.mkdtempSync(path.join(runtimesDir(), '.work-'))
  try {
    const archive = path.join(work, path.basename(new URL(asset.url).pathname))
    await downloadVerified(asset.url, archive, asset.sha256)
    const unpacked = path.join(work, 'unpacked')
    extractArchive(archive, unpacked)
    if (!fs.existsSync(path.join(unpacked, asset.executable))) throw new Error(`${asset.url} has no ${asset.executable}`)
    // audio.cpp's macOS archive stores its binaries without the executable bit (v0.8.2).
    fs.chmodSync(path.join(unpacked, asset.executable), 0o755)
    fs.renameSync(unpacked, folder)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
  return executable
}
