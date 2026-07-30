import { describe, expect, it } from 'vitest'
import { ApiError } from '../lib/errors'
import { parseImportConflict } from './transfer'

describe('import conflict validation', () => {
  it('defaults only an omitted field to newer', () => {
    expect(parseImportConflict(null)).toBe('newer')
    expect(parseImportConflict(undefined)).toBe('newer')
  })

  it.each(['skip', 'newer', 'duplicate'] as const)('accepts %s', (value) => {
    expect(parseImportConflict(value)).toBe(value)
  })

  it('rejects an unknown strategy instead of silently allowing updates', () => {
    expect(() => parseImportConflict('overwrite')).toThrowError(ApiError)
    expect(() => parseImportConflict('')).toThrow('conflict must be skip, newer, or duplicate')
  })
})
