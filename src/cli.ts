import path from 'node:path'
import { parseArgs } from 'node:util'
import { dataDir } from './core/paths.ts'
import { migrateResults } from './measure/runs.ts'
import { formatReport, readSummaries } from './measure/report.ts'
import { asr, listModels, runFilesOf, tts } from './cli/measure.ts'
import { neighbors, voices } from './cli/pages.ts'
import { web } from './cli/web.ts'
import { record } from './cli/record.ts'
import { reference, voice } from './cli/voices.ts'

const USAGE = `usage:
  node src/cli.ts models
  node src/cli.ts asr --locale ja-JP --models qwen3-asr-1.7b,parakeet-tdt_ctc-0.6b-ja [--set fleurs [--count 100] | --set recordings --speaker name]
      [--edges voice [--margin 0.2] | --edges as-recorded [--trailing-silence 0]] [--campaign name]
  node src/cli.ts tts --locale ja-JP --models qwen3-tts-0.6b,irodori-tts-v4-small [--voice ono_anna] [--seeds 1,2,3]
      [--designs young-woman-caption,young-man-caption] [--reference name] [--duration-scale 0.5] [--sentences sentences.json] [--only aizuchi-hai,reply-weather]
      [--campaign name]
  node src/cli.ts record --locale ja-JP --speaker name [--prompts prompts.json]
  node src/cli.ts report [--campaign name | run.jsonl ...]
  node src/cli.ts web [--port 5280]
  node src/cli.ts neighbors [--page name] [--campaign name | run.jsonl ...]
  node src/cli.ts reference --name name [--threshold 0.8] [--seconds 30] [--candidates 6 | --takes sentence@seed,...] result.jsonl ...
  node src/cli.ts voices [--page name] [--campaign name | run.jsonl ...]
  node src/cli.ts voice list --locale ja-JP
  node src/cli.ts voice gather <voice> --locale ja-JP [--model irodori-tts-v4-small-16steps] [--seeds 1,2,3,4,5]
  node src/cli.ts voice candidates <voice> --locale ja-JP [--threshold 0.8] [--seconds 10] [--count 3]
  node src/cli.ts voice try <voice> --locale ja-JP [--model irodori-tts-v4.1-small-mf] [--seeds 1,2]
  node src/cli.ts voice choose <voice> <candidate> --locale ja-JP
  node src/cli.ts migrate

Downloads, recordings and results go to ${dataDir()} (SPEECH_BENCH_DATA moves them).`

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'models') listModels()
  else if (command === 'asr') await asr(rest)
  else if (command === 'tts') await tts(rest)
  else if (command === 'record') await record(rest)
  else if (command === 'web') await web(rest)
  else if (command === 'neighbors') await neighbors(rest)
  else if (command === 'voices') await voices(rest)
  else if (command === 'reference') await reference(rest)
  else if (command === 'voice') await voice(rest)
  else if (command === 'report') {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { campaign: { type: 'string' } } })
    console.log(formatReport(readSummaries(runFilesOf(positionals, values.campaign))))
  } else if (command === 'migrate') console.log(`moved ${migrateResults()} runs into ${path.join(dataDir(), 'runs')}`)
  else {
    console.error(USAGE)
    process.exitCode = 2
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
