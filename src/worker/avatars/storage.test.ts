import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import { persistUploadedAvatar } from './storage'

const userId = '01j00000000000000000000000'
const png = `data:image/png;base64,${btoa(String.fromCharCode(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
))}`

describe('uploaded avatar object storage', () => {
  it('stores the bitmap in KV and returns only a compact internal URL', async () => {
    const put = vi.fn(async (_key: string, _value: Uint8Array) => undefined)
    const env = {
      DB: {} as D1Database,
      ASSETS: {} as Fetcher,
      FILES_KV: { put } as unknown as KVNamespace,
    } satisfies Env

    const stored = await persistUploadedAvatar(env, userId, png)

    expect(stored.storage).toBe('kv')
    expect(stored.preference).toMatch(
      /^\/api\/avatars\/kv\/01j00000000000000000000000\/[0-9a-hjkmnp-tv-z]{26}\.png$/,
    )
    expect(stored.preference).not.toContain('base64')
    expect(put).toHaveBeenCalledOnce()
    expect(Array.from(put.mock.calls[0]![1])).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })
})
