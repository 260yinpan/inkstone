import { describe, expect, it } from 'vitest'
import {
  decideRegistration,
  loginThrottleTargets,
  loginWorkTargets,
  normalizeAvatarPreference,
  normalizeDisplayName,
} from './auth'

describe('decideRegistration', () => {
  it('makes the first account the owner while registration is closed', () => {
    expect(
      decideRegistration({
        userCount: 0,
        registrationOpen: false,
      }),
    ).toEqual({ ok: true, role: 'owner' })
  })

  it('rejects another account while registration is closed', () => {
    expect(
      decideRegistration({
        userCount: 1,
        registrationOpen: false,
      }),
    ).toEqual({ ok: false, reason: 'registration_closed' })
  })

  it('creates subsequent accounts as members only when registration is open', () => {
    expect(
      decideRegistration({
        userCount: 1,
        registrationOpen: true,
      }),
    ).toEqual({ ok: true, role: 'member' })
  })
})

describe('auth boundary helpers', () => {
  it('uses a per-origin identity lock plus a wider IP spray guard', () => {
    expect(loginThrottleTargets('alice', '203.0.113.8')).toEqual([
      { key: 'login:203.0.113.8:alice', freeFails: 5 },
      { key: 'login-ip:203.0.113.8', freeFails: 25 },
    ])
    expect(loginThrottleTargets('not valid', 'local')[0]?.key).toBe('login:local:_invalid')
    expect(loginWorkTargets('alice', '203.0.113.8')).toEqual([
      { key: 'login-work:203.0.113.8:alice', maxAttempts: 8, windowMs: 600_000 },
      { key: 'login-work-ip:203.0.113.8', maxAttempts: 30, windowMs: 600_000 },
    ])
  })

  it('normalizes a Unicode display name without changing the sign-in username', () => {
    expect(normalizeDisplayName('  Alice   Chen  ')).toBe('Alice Chen')
    expect(normalizeDisplayName('  \u5c0f\u660e 🪨  ')).toBe('\u5c0f\u660e 🪨')
    expect(normalizeDisplayName('')).toBeNull()
    expect(normalizeDisplayName('x'.repeat(65))).toBeNull()
    expect(normalizeDisplayName(`Alice\u0000Chen`)).toBeNull()
  })

  it('accepts only compact generated seeds or validated bitmap data URLs', () => {
    const generated = 'dicebear:0123456789abcdef0123456789abcdef'
    const pngHeader = String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    const png = `data:image/png;base64,${btoa(pngHeader)}`

    expect(normalizeAvatarPreference('')).toBe('')
    expect(normalizeAvatarPreference(generated)).toBe(generated)
    expect(normalizeAvatarPreference(png)).toBe(png)
    expect(normalizeAvatarPreference('dicebear:short')).toBeNull()
    expect(normalizeAvatarPreference('https://tracker.invalid/avatar.png')).toBeNull()
    expect(normalizeAvatarPreference('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull()
    expect(normalizeAvatarPreference('data:image/png;base64,ZmFrZQ==')).toBeNull()
    expect(normalizeAvatarPreference(
      `data:image/png;base64,${'A'.repeat(Math.ceil(128 * 1024 / 3) * 4 + 4)}`,
    )).toBeNull()
  })
})
