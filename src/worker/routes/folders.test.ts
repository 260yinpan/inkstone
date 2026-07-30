import { describe, expect, it } from 'vitest'
import { ApiError } from '../lib/errors'
import { parseFolderDeleteStrategy } from './folders'

describe('folder delete strategy validation', () => {
  it('keeps the compatible move-up default when the query is omitted', () => {
    expect(parseFolderDeleteStrategy(undefined)).toBe('move-up')
    expect(parseFolderDeleteStrategy('')).toBe('move-up')
  })

  it.each(['move-up', 'delete'] as const)('accepts %s', (value) => {
    expect(parseFolderDeleteStrategy(value)).toBe(value)
  })

  it('rejects unknown strategies', () => {
    expect(() => parseFolderDeleteStrategy('remove')).toThrowError(ApiError)
  })
})
