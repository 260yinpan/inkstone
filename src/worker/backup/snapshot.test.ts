import { describe, expect, it } from 'vitest'
import { assertArchiveCanBeRestored, safeSegment } from './snapshot'

describe('portable backup paths', () => {
  it('removes cross-platform separators, controls, and trailing dots', () => {
    expect(safeSegment('  project: alpha/\u0000draft.  ')).toBe('project- alpha-draft')
  })

  it('does not emit Windows device names', () => {
    expect(safeSegment('CON')).toBe('_CON')
    expect(safeSegment('lpt1.txt')).toBe('_lpt1.txt')
  })

  it('stays portable when truncation lands on a trailing dot or inside an emoji', () => {
    expect(safeSegment(`${'a'.repeat(79)}.tail`)).toBe('a'.repeat(79))
    expect(safeSegment(`${'a'.repeat(79)}\u{1f600}`)).toBe('a'.repeat(79))
  })

  it('does not claim an archive is restorable when its entry count exceeds the importer', () => {
    const files = Array.from({ length: 2501 }, (_, index) => ({
      path: `notes/${index}.md`,
      body: new Uint8Array(),
      contentType: 'text/markdown',
    }))
    expect(() => assertArchiveCanBeRestored(files)).toThrow('restore limit')
  })
})
