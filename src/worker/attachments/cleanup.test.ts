import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import { drainAttachmentCleanup } from './cleanup'

interface QueueStatement {
  target: string
}

function cleanupDb(initial: string[]) {
  const queue = [...initial]
  const prepare = vi.fn((sql: string) => {
    if (sql.includes('SELECT object_key')) {
      const selected = sql.includes(`substr(object_key, 1, 3) = 'kv:'`)
        ? queue.filter((target) => target.startsWith('kv:'))
        : sql.includes(`substr(object_key, 1, 3) = 'r2:'`)
          ? queue.filter((target) => target.startsWith('r2:'))
          : queue
      return {
        bind: () => ({
          all: async () => ({
            results: selected.map((object_key) => ({ object_key })),
          }),
        }),
      }
    }
    if (sql.includes('DELETE FROM attachment_cleanup')) {
      return { bind: (target: string) => ({ target }) }
    }
    if (sql.includes('SELECT 1 AS pending')) {
      return { first: async () => queue.length ? { pending: 1 } : null }
    }
    throw new Error(`Unexpected SQL: ${sql}`)
  })
  const batch = vi.fn(async (statements: QueueStatement[]) => {
    for (const statement of statements) {
      const index = queue.indexOf(statement.target)
      if (index >= 0) queue.splice(index, 1)
    }
    return []
  })
  return { db: { prepare, batch } as unknown as D1Database, queue }
}

describe('attachment cleanup queue', () => {
  it('routes prefixed targets to the correct object backend', async () => {
    const { db, queue } = cleanupDb([
      'r2:user-1/r2.bin',
      'kv:user-1/kv.bin',
    ])
    const removeR2 = vi.fn(async () => undefined)
    const removeKv = vi.fn(async () => undefined)
    const env = {
      DB: db,
      ASSETS: {} as Fetcher,
      FILES: { delete: removeR2 } as unknown as R2Bucket,
      FILES_KV: { delete: removeKv } as unknown as KVNamespace,
    } satisfies Env

    await expect(drainAttachmentCleanup(env)).resolves.toEqual({ processed: 2, pending: false })
    expect(removeR2).toHaveBeenCalledWith(['user-1/r2.bin'])
    expect(removeKv).toHaveBeenCalledWith('user-1/kv.bin')
    expect(queue).toEqual([])
  })

  it('cleans KV targets without discarding pending objects from an unbound R2 backend', async () => {
    const { db, queue } = cleanupDb([
      'r2:user-1/old-r2.bin',
      'kv:user-1/current-kv.bin',
    ])
    const removeKv = vi.fn(async () => undefined)
    const env = {
      DB: db,
      ASSETS: {} as Fetcher,
      FILES_KV: { delete: removeKv } as unknown as KVNamespace,
    } satisfies Env

    await expect(drainAttachmentCleanup(env)).resolves.toEqual({ processed: 1, pending: true })
    expect(removeKv).toHaveBeenCalledWith('user-1/current-kv.bin')
    expect(queue).toEqual(['r2:user-1/old-r2.bin'])
  })
})
