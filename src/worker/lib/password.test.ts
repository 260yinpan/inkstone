import { describe, expect, it } from 'vitest'
import {
  hashPassword,
  isPasswordHash,
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  verifyPassword,
} from './password'

describe('password hashes', () => {
  it('creates and verifies the current bounded format', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(stored).toMatch(new RegExp(`^scrypt\\$${SCRYPT_N}\\$${SCRYPT_R}\\$${SCRYPT_P}\\$`))
    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true)
    await expect(verifyPassword('wrong password', stored)).resolves.toBe(false)
  })

  it('uses an independent random salt for each record', async () => {
    const first = await hashPassword('same-password')
    const second = await hashPassword('same-password')
    expect(first).not.toBe(second)
    await expect(verifyPassword('same-password', first)).resolves.toBe(true)
    await expect(verifyPassword('same-password', second)).resolves.toBe(true)
  })

  it('rejects every non-current or malformed record before running scrypt', async () => {
    const stored = await hashPassword('format-check-password')
    const lowerMemory = stored.replace(`scrypt$${SCRYPT_N}$`, 'scrypt$8192$')
    const otherParallelism = stored.replace(`$${SCRYPT_P}$`, '$4$')
    expect(isPasswordHash(lowerMemory)).toBe(false)
    expect(isPasswordHash(otherParallelism)).toBe(false)
    await expect(verifyPassword('format-check-password', lowerMemory)).resolves.toBe(false)
    await expect(verifyPassword('format-check-password', 'scrypt$16384$8$5$bad$bad')).resolves.toBe(false)
  })
})
