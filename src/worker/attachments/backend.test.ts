import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import {
  deleteAttachmentObjects,
  putAttachmentObject,
  readAttachmentObject,
  selectAttachmentStorage,
} from './backend'

const baseEnv = (): Env => ({ DB: {} as D1Database, ASSETS: {} as Fetcher })

describe('attachment object storage', () => {
  it('prefers R2 when both backends are configured and otherwise selects KV', () => {
    const r2 = {} as R2Bucket
    const kv = {} as KVNamespace
    expect(selectAttachmentStorage({ ...baseEnv(), FILES: r2, FILES_KV: kv })).toBe('r2')
    expect(selectAttachmentStorage({ ...baseEnv(), FILES_KV: kv })).toBe('kv')
    expect(selectAttachmentStorage(baseEnv())).toBeNull()
  })

  it('writes, reads, and deletes attachment bytes through Workers KV', async () => {
    const stored = new Map<string, Uint8Array>()
    const put = vi.fn(async (key: string, value: Uint8Array) => {
      stored.set(key, value.slice())
    })
    const get = vi.fn(async (key: string) => stored.get(key)?.slice().buffer ?? null)
    const remove = vi.fn(async (key: string) => {
      stored.delete(key)
    })
    const env = {
      ...baseEnv(),
      FILES_KV: { put, get, delete: remove } as unknown as KVNamespace,
    }
    const bytes = new Uint8Array([1, 2, 3, 4])
    const metadata = {
      userId: 'user-1',
      objectId: 'file-1',
      kind: 'attachment' as const,
      filename: 'diagram.png',
      mime: 'image/png',
      sha256: 'a'.repeat(64),
    }

    await putAttachmentObject(env, 'kv', 'user-1/file-1.png', bytes, metadata)
    expect(put).toHaveBeenCalledWith(
      'user-1/file-1.png',
      bytes,
      expect.objectContaining({ metadata }),
    )
    await expect(readAttachmentObject(env, 'kv', 'user-1/file-1.png')).resolves.toEqual(bytes)

    await deleteAttachmentObjects(env, 'kv', ['user-1/file-1.png'])
    expect(remove).toHaveBeenCalledWith('user-1/file-1.png')
    await expect(readAttachmentObject(env, 'kv', 'user-1/file-1.png')).resolves.toBeNull()
  })
})
