import { describe, expect, it } from 'vitest'
import { parseFleursTsv } from '../src/datasets/fleurs.ts'

describe('parseFleursTsv', () => {
  it('takes the file name and the raw transcription of each row', () => {
    const tsv = '1754\t9364520089078562923.wav\t地殻が薄いため、海が多くなることがあります。\t地殻が薄いため 海が多くなることがあります\t地 殻\t171840\tMALE\n'
    expect(parseFleursTsv(tsv)).toEqual([{ sentenceId: '1754', file: '9364520089078562923.wav', transcription: '地殻が薄いため、海が多くなることがあります。' }])
  })

  it('rejects a row without a transcription', () => {
    expect(() => parseFleursTsv('1754\tfile.wav\n')).toThrow()
  })
})
