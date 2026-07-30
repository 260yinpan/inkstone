import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import { persistAttachment, type PersistAttachmentInput } from './storage'

const input = (): PersistAttachmentInput => ({
  id: '01J00000000000000000000000',
  userId: 'user-1',
  noteId: null,
  filename: 'draft.txt',
  reportedMime: 'text/plain',
  bytes: new TextEncoder().encode('inkstone'),
  createdAt: 1_700_000_000_000,
})

describe('attachment persistence', () => {
  it('rejects new attachment writes when neither R2 nor KV is configured', async () => {
    const prepare = vi.fn()
    const env = { DB: { prepare } as unknown as D1Database, ASSETS: {} as Fetcher }

    await expect(persistAttachment(env, input())).rejects.toMatchObject({
      status: 503,
      code: 'storage_unavailable',
    })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('stores bytes in KV and writes only metadata to D1', async () => {
    const bindings: unknown[][] = []
    const prepare = vi.fn(() => ({
      bind: (...values: unknown[]) => ({
        run: async () => {
          bindings.push(values)
          return { meta: { changes: 1 } }
        },
      }),
    }))
    const put = vi.fn(async () => undefined)
    const env = {
      DB: { prepare } as unknown as D1Database,
      ASSETS: {} as Fetcher,
      FILES_KV: { put } as unknown as KVNamespace,
    } satisfies Env

    const stored = await persistAttachment(env, input())

    expect(stored.storage).toBe('kv')
    expect(put).toHaveBeenCalledOnce()
    expect(bindings).toHaveLength(1)
    expect(bindings[0]).toHaveLength(11)
    expect(bindings[0]?.[9]).toBe('kv')
    expect(bindings[0]?.[10]).toBe(input().createdAt)
  })
})
