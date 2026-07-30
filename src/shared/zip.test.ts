import { describe, expect, it } from 'vitest'
import { createZip, estimateZipSize, estimateZipSizeFromSizes, readZip } from './zip'

const text = (value: string) => new TextEncoder().encode(value)

describe('bounded ZIP transfer', () => {
  it('round-trips UTF-8 paths and verifies their contents', async () => {
    const source = [
      { path: 'notes/\u76ee\u5f55/\u7b14\u8bb0.md', data: text('# \u4e2d') },
      { path: 'inkstone-export.json', data: text('{"ok":true}') },
    ]
    const archive = createZip(source)
    expect(estimateZipSize(source)).toBe(archive.byteLength)
    expect(estimateZipSizeFromSizes(source.map((entry) => ({
      path: entry.path,
      byteLength: entry.data.byteLength,
    })))).toBe(archive.byteLength)
    const entries = await readZip(archive)
    expect(entries.map((entry) => entry.path)).toEqual([
      'notes/\u76ee\u5f55/\u7b14\u8bb0.md',
      'inkstone-export.json',
    ])
    expect(new TextDecoder().decode(entries[0]!.data)).toBe('# \u4e2d')
  })

  it('never creates traversal, absolute, or case-colliding paths', () => {
    expect(() => createZip([{ path: '../escape.md', data: text('x') }])).toThrow(/parent traversal path/)
    expect(() => createZip([{ path: 'C:\\escape.md', data: text('x') }])).toThrow(/absolute path/)
    expect(() => createZip([
      { path: 'Notes/a.md', data: text('a') },
      { path: 'notes/A.md', data: text('b') },
    ])).toThrow(/duplicate path/)
  })

  it('enforces entry counts and expanded byte limits before extraction', async () => {
    const archive = createZip([
      { path: 'a.md', data: text('1234') },
      { path: 'b.md', data: text('5678') },
    ])
    await expect(readZip(archive, { maxEntries: 1 })).rejects.toThrow(/exceed.*1/i)
    await expect(readZip(archive, { maxTotalBytes: 7 })).rejects.toThrow(/Expanded ZIP data exceeds/)
    await expect(readZip(archive, { maxEntryBytes: 3 })).rejects.toThrow(/ZIP entry is too large/)
  })

  it('rejects CRC corruption and unsupported compression methods', async () => {
    const corrupt = createZip([{ path: 'a.md', data: text('safe') }]).slice()
    const nameLength = new DataView(corrupt.buffer).getUint16(26, true)
    corrupt[30 + nameLength] ^= 0xff
    await expect(readZip(corrupt)).rejects.toThrow(/checksum failed/)

    const unsupported = createZip([{ path: 'a.md', data: text('safe') }]).slice()
    const view = new DataView(unsupported.buffer)
    view.setUint16(8, 99, true)
    const central = unsupported.findIndex((_, index) =>
      index + 4 <= unsupported.length && view.getUint32(index, true) === 0x02014b50)
    view.setUint16(central + 10, 99, true)
    await expect(readZip(unsupported)).rejects.toThrow(/unsupported compression method/)
  })

  it('rejects a local filename that disagrees with the signed central directory', async () => {
    const archive = createZip([{ path: 'a.md', data: text('safe') }]).slice()
    archive[30] = 'b'.charCodeAt(0)
    await expect(readZip(archive)).rejects.toThrow(/filename does not match/)
  })
})
