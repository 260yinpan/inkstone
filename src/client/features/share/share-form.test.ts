import { describe, expect, it } from 'vitest'
import {
  expiresInForSelection,
  KEEP_CURRENT_EXPIRY,
  needsNewSharePasscode,
} from './share-form'

describe('share form payloads', () => {
  it('omits an existing expiration until the user explicitly changes it', () => {
    expect(expiresInForSelection(KEEP_CURRENT_EXPIRY)).toBeUndefined()
    expect(expiresInForSelection('0')).toBeNull()
    expect(expiresInForSelection(String(7 * 24 * 60 * 60 * 1000))).toBe(604_800_000)
  })

  it('requires a passcode only when enabling protection for the first time', () => {
    expect(needsNewSharePasscode(true, false, '')).toBe(true)
    expect(needsNewSharePasscode(true, true, '')).toBe(false)
    expect(needsNewSharePasscode(false, false, '')).toBe(false)
    expect(needsNewSharePasscode(true, false, 'secret')).toBe(false)
  })
})
