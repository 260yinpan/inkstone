import { describe, expect, it } from 'vitest'
import { parseQuery } from './search'

describe('search qualifier parsing', () => {
  it('keeps an unknown is qualifier as searchable text instead of matching every note', () => {
    const parsed = parseQuery('is:unknown')
    expect(parsed.terms).toEqual(['is:unknown'])
    expect(parsed.text).toBe('is:unknown')
  })

  it('matches known qualifier values without case sensitivity', () => {
    const parsed = parseQuery('is:Starred in:TRASH')
    expect(parsed.starred).toBe(true)
    expect(parsed.trash).toBe(true)
    expect(parsed.terms).toEqual([])
  })
})
