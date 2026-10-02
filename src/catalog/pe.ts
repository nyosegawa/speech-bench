import fs from 'node:fs'

/**
 * Makes a 64-bit Windows module import a DLL under another name, by rewriting the name in its import table in place.
 * The new name may not be longer than the old one, so that nothing else in the file moves.
 */
export function renameImport(file: string, from: string, to: string): void {
  if (to.length > from.length) throw new Error(`${to} is longer than ${from}, which ${file} imports; the name is rewritten in place`)
  const module = fs.readFileSync(file)
  const header = module.readUInt32LE(0x3c)
  if (module.toString('latin1', header, header + 4) !== 'PE\0\0') throw new Error(`${file} is not a Windows module`)
  const optional = header + 24
  if (module.readUInt16LE(optional) !== 0x20b) throw new Error(`${file} is not a 64-bit Windows module`)
  const sections = module.readUInt16LE(header + 6)
  const sectionTable = optional + module.readUInt16LE(header + 20)
  const offsetOf = (rva: number): number => {
    for (let index = 0; index < sections; index++) {
      const section = sectionTable + index * 40
      const address = module.readUInt32LE(section + 12)
      const size = Math.max(module.readUInt32LE(section + 8), module.readUInt32LE(section + 16))
      if (rva >= address && rva < address + size) return rva - address + module.readUInt32LE(section + 20)
    }
    throw new Error(`${file} has an import table outside its sections`)
  }
  // The import directory is the second entry of the data directories, which start 112 bytes into a PE32+ header.
  let descriptor = offsetOf(module.readUInt32LE(optional + 112 + 8))
  for (; module.subarray(descriptor, descriptor + 20).some((byte) => byte !== 0); descriptor += 20) {
    const name = offsetOf(module.readUInt32LE(descriptor + 12))
    const end = module.indexOf(0, name)
    if (module.toString('latin1', name, end).toLowerCase() !== from.toLowerCase()) continue
    module.fill(0, name, end)
    module.write(to, name, 'latin1')
    fs.writeFileSync(file, module)
    return
  }
  throw new Error(`${file} does not import ${from}`)
}
