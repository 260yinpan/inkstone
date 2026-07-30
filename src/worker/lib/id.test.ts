import { describe, expect, it } from 'vitest'
import { isValidSlug, newSlug } from './id'

describe('public share identifiers', () => {
  it('uses a canonical 100-bit bearer slug', () => {
    const slug = newSlug()
    expect(slug).toMatch(/^[0-9a-hjkmnp-tv-z]{20}$/)
    expect(isValidSlug(slug)).toBe(true)
    expect(isValidSlug(slug.toUpperCase())).toBe(false)
    expect(isValidSlug('a'.repeat(12))).toBe(false)
  })
})
