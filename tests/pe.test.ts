import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renameImport } from '../src/catalog/pe.ts'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})

/**
 * The headers of a 64-bit Windows module with one section that holds its import table: a descriptor for each DLL,
 * an empty one after them, and their names.
 */
function moduleImporting(dlls: readonly string[]): string {
  const module = Buffer.alloc(0x400)
  module.writeUInt32LE(0x40, 0x3c)
  module.write('PE\0\0', 0x40, 'latin1')
  module.writeUInt16LE(0x8664, 0x44)
  module.writeUInt16LE(1, 0x46)
  module.writeUInt16LE(0xf0, 0x54)
  module.writeUInt16LE(0x20b, 0x58)
  module.writeUInt32LE(0x1000, 0x58 + 112 + 8)
  const section = 0x58 + 0xf0
  module.write('.idata', section, 'latin1')
  module.writeUInt32LE(0x200, section + 8)
  module.writeUInt32LE(0x1000, section + 12)
  module.writeUInt32LE(0x200, section + 16)
  module.writeUInt32LE(0x200, section + 20)
  dlls.forEach((dll, index) => {
    const name = 0x100 + index * 0x20
    module.writeUInt32LE(0x1000 + name, 0x200 + index * 20 + 12)
    module.writeUInt32LE(0x1000 + 0x180, 0x200 + index * 20 + 16)
    module.write(dll, 0x200 + name, 'latin1')
  })
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-'))
  folders.push(folder)
  const file = path.join(folder, 'module.dll')
  fs.writeFileSync(file, module)
  return file
}

const importedNames = (file: string, count: number): string[] => {
  const module = fs.readFileSync(file)
  return Array.from({ length: count }, (_, index) => module.toString('latin1', 0x300 + index * 0x20, module.indexOf(0, 0x300 + index * 0x20)))
}

describe('renameImport', () => {
  it('rewrites the name of one imported DLL and leaves the others and the size of the file as they are', () => {
    const file = moduleImporting(['KERNEL32.dll', 'onnxruntime.dll', 'ADVAPI32.dll'])
    renameImport(file, 'onnxruntime.dll', 'sherpa-ort.dll')
    expect(importedNames(file, 3)).toEqual(['KERNEL32.dll', 'sherpa-ort.dll', 'ADVAPI32.dll'])
    expect(fs.statSync(file).size).toBe(0x400)
  })

  it('stops at a DLL the module does not import, and at a name that would not fit', () => {
    const file = moduleImporting(['KERNEL32.dll'])
    expect(() => renameImport(file, 'onnxruntime.dll', 'sherpa-ort.dll')).toThrow(/does not import onnxruntime\.dll/)
    expect(() => renameImport(file, 'KERNEL32.dll', 'a-longer-name.dll')).toThrow(/longer/)
    expect(importedNames(file, 1)).toEqual(['KERNEL32.dll'])
  })
})
