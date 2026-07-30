import { beforeEach, describe, expect, it, vi } from 'vitest'

const memory = vi.hoisted(() => ({
  values: new Map<IDBValidKey, unknown>(),
  writes: Promise.resolve() as Promise<void>,
  clearError: null as Error | null,
}))

vi.mock('idb-keyval', () => {
  const serialize = (operation: () => void): Promise<void> => {
    const next = memory.writes.then(operation)
    memory.writes = next.catch(() => {})
    return next
  }
  return {
    createStore: vi.fn(() => Symbol('store')),
    get: vi.fn(async (key: IDBValidKey) => memory.values.get(key)),
    getMany: vi.fn(async (keys: IDBValidKey[]) => keys.map((key) => memory.values.get(key))),
    set: vi.fn((key: IDBValidKey, value: unknown) => serialize(() => { memory.values.set(key, value) })),
    setMany: vi.fn((entries: [IDBValidKey, unknown][]) => serialize(() => {
      for (const [key, value] of entries) memory.values.set(key, value)
    })),
    update: vi.fn((key: IDBValidKey, updater: (value: unknown) => unknown) => serialize(() => {
      memory.values.set(key, updater(memory.values.get(key)))
    })),
    del: vi.fn((key: IDBValidKey) => serialize(() => { memory.values.delete(key) })),
    clear: vi.fn(() => serialize(() => {
      if (memory.clearError) throw memory.clearError
      memory.values.clear()
    })),
  }
})

import { localDb, type OutboxItem } from './db'

function item(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: 'patch:client-a:note-a',
    clientId: 'client-a',
    writeId: 'write-a',
    noteId: 'note-a',
    payload: { content: '# A', rev: 1 },
    attempts: 0,
    createdAt: 10,
    ...overrides,
  }
}

beforeEach(async () => {
  await memory.writes
  memory.values.clear()
  memory.writes = Promise.resolve()
  memory.clearError = null
})

describe('durable local outbox', () => {
  it('quarantines malformed shell and note-content cache values', async () => {
    memory.values.set('notes', { broken: true })
    memory.values.set('folders', 'broken')
    memory.values.set('tags', null)
    memory.values.set('cursor', Number.NaN)
    memory.values.set('note:note-a', { content: 42, rev: 0, updatedAt: 'now' })

    await expect(localDb.loadShell()).resolves.toBeNull()
    await expect(localDb.getContent('note-a')).resolves.toBeUndefined()

    memory.values.set('notes', [])
    memory.values.set('folders', [])
    memory.values.set('tags', [])
    memory.values.set('cursor', 0)
    await expect(localDb.loadShell()).resolves.toEqual({
      notes: [],
      folders: [],
      tags: [],
      cursor: 0,
    })
  })

  it('does not bind a new user when clearing the previous user cache fails', async () => {
    memory.values.set('userId', 'user-a')
    memory.values.set('notes', [{ id: 'private-note' }])
    memory.clearError = new Error('storage unavailable')

    await expect(localDb.bindUser('user-b')).rejects.toThrow('storage unavailable')
    expect(memory.values.get('userId')).toBe('user-a')
    expect(memory.values.get('notes')).toEqual([{ id: 'private-note' }])

    memory.clearError = null
    await expect(localDb.bindUser('user-b')).resolves.toBeUndefined()
    expect(memory.values.get('userId')).toBe('user-b')
    expect(memory.values.has('notes')).toBe(false)
  })

  it('quarantines malformed storage entries instead of crashing replay or later writes', async () => {
    const valid = item()
    memory.values.set('outbox', [null, 'broken', { id: 'partial' }, valid])

    expect(await localDb.getOutbox()).toEqual([valid])

    const next = item({
      id: 'patch:client-b:note-b',
      clientId: 'client-b',
      writeId: 'write-b',
      noteId: 'note-b',
    })
    await localDb.enqueueOutbox(next)
    expect(await localDb.getOutbox()).toEqual([valid, next])
  })

  it('serializes concurrent tab enqueues without dropping either write', async () => {
    const first = item()
    const second = item({
      id: 'patch:client-b:note-b',
      clientId: 'client-b',
      writeId: 'write-b',
      noteId: 'note-b',
      payload: { content: '# B', rev: 4 },
    })

    await Promise.all([localDb.enqueueOutbox(first), localDb.enqueueOutbox(second)])

    expect(await localDb.getOutbox()).toEqual([first, second])
  })

  it('keeps a newer write when an older network request completes', async () => {
    const first = item()
    const newer = item({ writeId: 'write-new', payload: { content: '# New', rev: 1 }, createdAt: 20 })
    await localDb.enqueueOutbox(first)
    await localDb.enqueueOutbox(newer)

    await localDb.completeOutboxItem(first.id, first.writeId)
    expect(await localDb.getOutbox()).toEqual([{ ...newer, createdAt: first.createdAt }])

    await localDb.updateOutboxRevision(newer.id, newer.writeId, 2)
    expect(await localDb.getOutbox()).toMatchObject([
      { writeId: newer.writeId, payload: { content: '# New', rev: 2 } },
    ])
  })

  it('durably records conflict rebases and a stable deletion-recovery id', async () => {
    const pending = item()
    await localDb.enqueueOutbox(pending)

    await localDb.updateOutboxRevision(pending.id, pending.writeId, 4, true)
    await localDb.setOutboxRecoveryId(pending.id, pending.writeId, '01h00000000000000000000000')

    expect(await localDb.getOutbox()).toEqual([
      {
        ...pending,
        payload: {
          content: '# A',
          rev: 4,
          preserveVersion: true,
          recoveryId: '01h00000000000000000000000',
        },
      },
    ])
  })

  it('advances only journals that explicitly depend on the acknowledged write', async () => {
    const source = item()
    const dependent = item({
      id: 'patch:client-b:note-a',
      clientId: 'client-b',
      writeId: 'write-b',
      dependsOnWriteId: source.writeId,
      payload: { content: '# Continued', rev: 1 },
      createdAt: 20,
    })
    const concurrent = item({
      id: 'patch:client-c:note-a',
      clientId: 'client-c',
      writeId: 'write-c',
      payload: { content: '# Independent', rev: 1 },
      createdAt: 30,
    })
    await Promise.all([
      localDb.enqueueOutbox(source),
      localDb.enqueueOutbox(dependent),
      localDb.enqueueOutbox(concurrent),
    ])

    await localDb.advanceOutboxDependents(source.noteId, source.writeId, 1, 2)

    expect(await localDb.getOutbox()).toEqual([
      source,
      { ...dependent, dependsOnWriteId: undefined, payload: { content: '# Continued', rev: 2 } },
      concurrent,
    ])
  })

  it('queues a second fallback replay holder until the first releases the lease', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const first = localDb.withOutboxReplayLock('client-a', () => held)
    await vi.waitFor(() => expect(memory.values.get('outboxReplayLease')).toBeTruthy())

    let secondStarted = false
    const second = localDb.withOutboxReplayLock('client-b', async () => {
      secondStarted = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(secondStarted).toBe(false)

    release()
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(secondStarted).toBe(true)
  })
})
