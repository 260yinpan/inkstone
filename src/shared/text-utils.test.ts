import { describe, expect, it } from 'vitest'
import { sliceText, truncateText, utf8ByteLength } from './text-utils'

describe('Unicode-safe text slicing', () => {
  it('never introduces an unpaired surrogate at a truncation boundary', () => {
    const value = `aaaa\u{1f600}b`
    expect(truncateText(value, 5)).toBe('aaaa')
    expect(truncateText(value, 6)).toBe(`aaaa\u{1f600}`)
  })

  it('drops a code point when either requested slice boundary lands inside it', () => {
    const value = `a\u{1f600}b`
    expect(sliceText(value, 0, 2)).toBe('a')
    expect(sliceText(value, 2, 4)).toBe('b')
  })

  it('handles invalid or non-positive limits without throwing', () => {
    expect(truncateText('text', Number.NaN)).toBe('')
    expect(truncateText('text', 0)).toBe('')
  })

  it('reports storage sizes in UTF-8 bytes', () => {
    expect(utf8ByteLength(`A\u{1f600}\u4e2d`)).toBe(8)
  })
})
