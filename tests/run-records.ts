import { RESULT_FORMAT, type AsrRunRecord, type TtsRunRecord } from '../src/measure/result-file/format.ts'

const common = {
  type: 'run' as const,
  format: RESULT_FORMAT,
  startedAt: '2026-10-01T00:00:00.000Z',
  machine: { platform: 'darwin-arm64' as const, hostname: 'mac', os: 'macOS 26.2', cpu: 'Apple M5', memoryGb: 32, gpus: ['Apple M5'] },
  set: { name: 'set', locale: 'ja-JP', size: 1 },
  model: { id: 'model', label: 'Model', license: 'MIT', files: [] },
  runtime: { id: 'llama.cpp', version: 'b1', options: {} },
  loadSeconds: 1,
  warmupSeconds: 1
}

/** A whole run line of a recognition run, with the fields a test cares about given. */
export const asrRun = (fields: Partial<AsrRunRecord> = {}): AsrRunRecord => ({
  ...common,
  task: 'asr' as const,
  audio: { edges: 'voice' as const, detector: 'silero-vad-v4', marginSeconds: 0.2 },
  ...fields
})

/** A whole run line of a synthesis run, with the fields a test cares about given. */
export const ttsRun = (fields: Partial<TtsRunRecord> = {}): TtsRunRecord => ({
  ...common,
  task: 'tts' as const,
  voice: null,
  seed: null,
  design: null,
  reference: null,
  durationScale: null,
  recognizer: { id: 'qwen3-asr-1.7b', label: 'Qwen3-ASR 1.7B' },
  ...fields
})
