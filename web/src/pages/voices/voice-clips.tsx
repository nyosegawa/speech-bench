import { Square } from 'lucide-react'
import type { Player } from '@/components/player.tsx'
import { Button } from '@/components/ui/button.tsx'
import { runColor } from '@/lib/figures.ts'
import type { VoiceDetail } from '@/lib/api.ts'

export type VoicesData = NonNullable<VoiceDetail['tries']>

/** Something the voices pages play: a reference voice or a take, with what to say while it plays. */
export interface Clip {
  key: string
  url: string
  label: string
  color: number
}

export const referenceClip = (data: VoicesData, candidate: number, name: string, color: number): Clip => ({
  key: `reference-${candidate}`,
  url: data.candidates[candidate]!.reference.url,
  label: `${name} · reference: ${data.candidates[candidate]!.reference.texts.join(' / ')}`,
  color
})

export function takeClip(data: VoicesData, candidate: number, run: number, sentence: number, name: string, color: number): Clip | null {
  const take = data.sentences[sentence]!.takes[candidate]?.[run]
  if (!take) return null
  return { key: `take-${candidate}-${run}-${sentence}`, url: take.url, label: `${name}, ${data.candidates[candidate]!.runs[run]} · ${data.sentences[sentence]!.text} — heard: ${take.transcript}`, color }
}

/** Every sentence of one candidate's first run, in order. */
export const sentenceClips = (data: VoicesData, candidate: number, name: string, color: number): Clip[] =>
  data.sentences.flatMap((_, sentence) => takeClip(data, candidate, 0, sentence, name, color) ?? [])

export function NowPlaying({ player, idle }: { player: Player<Clip>; idle: string }) {
  if (player.error) return <span className="text-sm text-destructive">{player.error}</span>
  if (!player.current) return <span className="text-sm text-muted-foreground">{idle}</span>
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-sm" style={runColor(player.current.color)}>
      <span className="size-2.5 shrink-0 rounded-full bg-(--run)" />
      <span className="truncate">{player.current.label}</span>
      <Button variant="outline" size="sm" className="ml-auto" onClick={player.stop}><Square />Stop</Button>
    </div>
  )
}
