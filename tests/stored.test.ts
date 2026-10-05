import { describe, expect, it } from 'vitest'
import { currentVersion, upgrade, type Upgrades } from '../src/core/stored.ts'
import { parseCampaign } from '../src/measure/campaign-file/file.ts'
import { parseResultFile } from '../src/measure/result-file/file.ts'
import { asrRun } from './run-records.ts'

type Raw = { steps: string[] }
const upgrades: Upgrades<Raw> = {
  name: 'test format',
  earliest: 3,
  steps: [
    { upgrade: (raw) => ({ steps: [...raw.steps, '3-4'] }) },
    { adds: ['note'] },
    { upgrade: (raw) => ({ steps: [...raw.steps, '5-6'] }) }
  ]
}

describe('upgrading a stored form', () => {
  it('takes the current version from the earliest one and the steps after it', () => {
    expect(currentVersion(upgrades)).toBe(6)
  })

  it('applies the steps from the version of the file on, in order, passing over a step that only adds a field', () => {
    expect(upgrade(upgrades, { steps: [] }, 3, 'file').steps).toEqual(['3-4', '5-6'])
    expect(upgrade(upgrades, { steps: [] }, 5, 'file').steps).toEqual(['5-6'])
    expect(upgrade(upgrades, { steps: [] }, 6, 'file').steps).toEqual([])
  })

  it('refuses a version before the earliest, after the current or not a whole number, naming the file and the versions it reads', () => {
    for (const version of [2, 7, '4', 4.5, undefined]) {
      expect(() => upgrade(upgrades, { steps: [] }, version, 'a.json')).toThrow(`a.json is of test format ${String(version)}; this build reads test format 3 to 6`)
    }
  })
})

describe('reading a result file', () => {
  const line = (record: object): string => JSON.stringify(record)
  const heard = { type: 'utterance', id: 'u1', audioSeconds: 2, reference: 'はい', text: 'はい', seconds: 0.1 }

  it('refuses a file that does not start with its run line', () => {
    expect(() => parseResultFile([line(heard), line(asrRun())].join('\n'), 'run.jsonl')).toThrow('run.jsonl does not start with a run line')
  })

  it('refuses a format this build does not read, naming the file and its format', () => {
    expect(() => parseResultFile(line({ ...asrRun(), format: 11 }), 'run.jsonl')).toThrow(/run\.jsonl is of result format 11/)
  })

  it('refuses a record that does not fit the form, naming the line and the field', () => {
    const { seconds: _, ...withoutSeconds } = heard
    expect(() => parseResultFile([line(asrRun()), line(heard), line(withoutSeconds)].join('\n'), 'run.jsonl')).toThrow(/run\.jsonl line 3 .*seconds/)
    expect(() => parseResultFile(line({ ...asrRun(), audio: { edges: 'voice' } }), 'run.jsonl')).toThrow(/run\.jsonl line 1 .*audio\.detector/)
  })

  it('refuses a record of the other task', () => {
    const sentence = { type: 'sentence', id: 's1', kind: 'reply', text: 'はい', audio: 's1.wav', audioSeconds: 1, firstAudioSeconds: 0.1, totalSeconds: 0.5, transcript: 'はい' }
    expect(() => parseResultFile([line(asrRun()), line(sentence)].join('\n'), 'run.jsonl')).toThrow(/run\.jsonl line 2/)
  })
})

describe('reading a campaign', () => {
  it('refuses a campaign whose runs are not a list of names, naming the file and the field', () => {
    expect(() => parseCampaign(JSON.stringify({ format: 1, name: 'voices', runs: 'tts-a' }), 'voices.json')).toThrow(/voices\.json .*runs/)
  })
})
