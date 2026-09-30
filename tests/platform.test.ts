import { describe, expect, it } from 'vitest'
import { windowsName } from '../src/platform.ts'

describe('windowsName', () => {
  it('tells Windows 11 from Windows 10 by the build, since both report version 10.0', () => {
    expect(windowsName('10.0.26200')).toBe('Windows 11 (build 26200)')
    expect(windowsName('10.0.19045')).toBe('Windows 10 (build 19045)')
  })
})
