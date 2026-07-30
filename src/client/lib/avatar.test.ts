import { describe, expect, it } from 'vitest'
import { GENERATED_AVATAR_PREFIX, generatedAvatarPreference } from '@shared/avatar'
import {
  avatarBackgroundColor,
  AvatarUploadError,
  createAvatarDataUri,
  createRandomAvatarPreferences,
  prepareAvatarUpload,
  resolveAvatarSource,
} from './avatar'

describe('avatar generation', () => {
  it('reuses the NodeCrypt palette deterministically for a display name', () => {
    const first = createAvatarDataUri('Alice')
    const again = createAvatarDataUri('Alice')
    const other = createAvatarDataUri('Bob')

    expect(first).toBe(again)
    expect(first).toMatch(/^data:image\/svg\+xml/)
    expect(other).not.toBe(first)
    expect(['f87171', 'fb923c', '09acf4', 'f472b6', 'a78bfa', '34d399'])
      .toContain(avatarBackgroundColor('Alice'))
  })

  it('derives the default from the display name but honors random and uploaded choices', () => {
    expect(resolveAvatarSource('', 'Alice')).toBe(createAvatarDataUri('Alice'))
    expect(resolveAvatarSource('', 'Bob')).toBe(createAvatarDataUri('Bob'))

    const random = generatedAvatarPreference('0123456789abcdef0123456789abcdef')
    expect(resolveAvatarSource(random, 'Alice'))
      .toBe(createAvatarDataUri('0123456789abcdef0123456789abcdef'))

    const uploaded = 'data:image/png;base64,iVBORw0KGgo='
    expect(resolveAvatarSource(uploaded, 'Alice')).toBe(uploaded)
    const stored = '/api/avatars/kv/01j00000000000000000000000/01j00000000000000000000001.png'
    expect(resolveAvatarSource(stored, 'Alice')).toBe(stored)
    expect(resolveAvatarSource('https://tracker.invalid/avatar.png', 'Alice'))
      .toBe(createAvatarDataUri('Alice'))
  })

  it('creates five unique cryptographic random preferences independent of the name', () => {
    const choices = createRandomAvatarPreferences()
    expect(choices).toHaveLength(5)
    expect(new Set(choices).size).toBe(5)
    for (const choice of choices) {
      expect(choice).toMatch(new RegExp(`^${GENERATED_AVATAR_PREFIX}[a-f0-9]{32}$`))
    }
  })

  it('rejects unsupported and oversized local files before decoding', async () => {
    await expect(prepareAvatarUpload(new File(['<svg/>'], 'avatar.svg', { type: 'image/svg+xml' })))
      .rejects.toEqual(new AvatarUploadError('unsupported'))
    await expect(prepareAvatarUpload(new File(
      [new Uint8Array(8 * 1024 * 1024 + 1)],
      'huge.png',
      { type: 'image/png' },
    ))).rejects.toEqual(new AvatarUploadError('too_large'))
  })
})
