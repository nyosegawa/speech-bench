import { describe, expect, it } from 'vitest'
import { tagCovers } from '../src/language.ts'

describe('tagCovers', () => {
  it('lets a tag without a region cover every region of the language', () => {
    expect(tagCovers('pt', 'pt-BR')).toBe(true)
    expect(tagCovers('es', 'es-419')).toBe(true)
  })

  it('keeps a regional tag to its region', () => {
    expect(tagCovers('pt-BR', 'pt-BR')).toBe(true)
    expect(tagCovers('pt-BR', 'pt-PT')).toBe(false)
  })

  it('does not match another language', () => {
    expect(tagCovers('ja', 'en-US')).toBe(false)
  })
})
