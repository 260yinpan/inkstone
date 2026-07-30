import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getLocale, setLocale } from './i18n'
import { formatBytes, formatDuration, fullTime, groupLabel, relativeTime } from './time'

describe('time and size formatting boundaries', () => {
  let previousLocale: ReturnType<typeof getLocale>
  beforeEach(() => {
    previousLocale = getLocale()
  })
  afterEach(() => setLocale(previousLocale, false))

  it('formats future timestamps as future instead of just now', () => {
    setLocale('en-US', false)
    const now = Date.UTC(2026, 6, 30, 0, 0, 0)
    expect(relativeTime(now + 2 * 60 * 60 * 1000, now)).toBe('in 2 hours')
  })

  it('carries rounded seconds into minutes', () => {
    setLocale('en-US', false)
    expect(formatDuration(59_950)).toBe('1 minute 0 seconds')
    expect(formatDuration(119_600)).toBe('2 minutes 0 seconds')
  })

  it('does not group arbitrary future dates into this week', () => {
    setLocale('en-US', false)
    const now = new Date(2026, 6, 30, 12).getTime()
    const future = new Date(2027, 0, 2, 12).getTime()
    expect(groupLabel(future, now)).toBe('January 2027')
    expect(groupLabel(Number.NaN, now)).toBe('—')
  })

  it('does not leak NaN or invalid dates into the interface', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B')
    expect(formatBytes(-12)).toBe('0 B')
    expect(fullTime(Number.POSITIVE_INFINITY)).toBe('—')
  })
})
