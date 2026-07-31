import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Folder, Note, PatchNoteBody, SyncResponse } from '@shared/types'
import type { OutboxItem } from '../lib/db'

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  purge: vi.fn(),
  duplicate: vi.fn(),
  sync: vi.fn(),
  listFolders: vi.fn(),
  listTags: vi.fn(),
  setContent: vi.fn(async () => undefined),
  getContent: vi.fn<() => Promise<{
    content: string
    rev: number
    updatedAt: number
    writeId?: string
    pendingTitle?: string
    contentDirty?: boolean
  } | undefined>>(async () => undefined),
  scheduleShellSave: vi.fn(),
  dropContent: vi.fn(async () => undefined),
  getOutbox: vi.fn<() => Promise<OutboxItem[]>>(async () => []),
  enqueueOutbox: vi.fn<(item: OutboxItem) => Promise<void>>(async () => undefined),
  completeOutboxItem: vi.fn<(id: string, writeId: string) => Promise<void>>(async () => undefined),
  updateOutboxRevision: vi.fn<(
    id: string,
    writeId: string,
    rev: number,
    preserveVersion?: boolean,
  ) => Promise<void>>(async () => undefined),
  setOutboxRecoveryId: vi.fn<(id: string, writeId: string, recoveryId: string) => Promise<void>>(async () => undefined),
  advanceOutboxDependents: vi.fn<(
    noteId: string,
    sourceWriteId: string,
    expectedRev: number,
    nextRev: number,
  ) => Promise<void>>(async () => undefined),
  markOutboxFailure: vi.fn<(id: string, writeId: string, message: string) => Promise<void>>(async () => undefined),
  withOutboxReplayLock: vi.fn<(owner: string, task: () => Promise<void>) => Promise<boolean>>(async (_owner, task) => {
    await task()
    return true
  }),
  publishBroadcast: vi.fn(),
}))

vi.mock('../lib/db', () => ({
  localDb: {
    setContent: mocks.setContent,
    getContent: mocks.getContent,
    scheduleShellSave: mocks.scheduleShellSave,
    dropContent: mocks.dropContent,
    getOutbox: mocks.getOutbox,
    enqueueOutbox: mocks.enqueueOutbox,
    completeOutboxItem: mocks.completeOutboxItem,
    updateOutboxRevision: mocks.updateOutboxRevision,
    setOutboxRecoveryId: mocks.setOutboxRecoveryId,
    advanceOutboxDependents: mocks.advanceOutboxDependents,
    markOutboxFailure: mocks.markOutboxFailure,
    withOutboxReplayLock: mocks.withOutboxReplayLock,
  },
  publishBroadcast: mocks.publishBroadcast,
}))

vi.mock('../lib/api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
      readonly details?: unknown,
    ) {
      super(message)
    }

    get isOffline() { return this.status === 0 }
    get isAuth() { return this.status === 401 }
    get isConflict() { return this.status === 409 }
  }
  return {
    CLIENT_ID: 'test-client',
    api: {
      sync: mocks.sync,
      folders: { list: mocks.listFolders },
      tags: { list: mocks.listTags },
      notes: {
        patch: mocks.patch,
        get: mocks.get,
        create: mocks.create,
        remove: mocks.remove,
        restore: mocks.restore,
        purge: mocks.purge,
        duplicate: mocks.duplicate,
      },
    },
    ApiError,
  }
})

import { acknowledgeOutboxBaseAdvanced, acknowledgeOutboxResult, useNotes } from './notes'
import { useSession } from './session'
import { useUi } from './ui'
import { ApiError } from '../lib/api'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function installMemoryOutbox(): OutboxItem[] {
  const outbox: OutboxItem[] = []
  mocks.getOutbox.mockImplementation(async () => outbox.map((item) => ({
    ...item,
    payload: { ...item.payload },
  })))
  mocks.enqueueOutbox.mockImplementation(async (item) => {
    const index = outbox.findIndex((entry) => entry.id === item.id)
    const stored = {
      ...item,
      payload: { ...item.payload },
      createdAt: index >= 0 ? outbox[index]!.createdAt : item.createdAt,
    }
    if (index >= 0) outbox.splice(index, 1, stored)
    else outbox.push(stored)
  })
  mocks.completeOutboxItem.mockImplementation(async (id, writeId) => {
    const index = outbox.findIndex((item) => item.id === id && item.writeId === writeId)
    if (index >= 0) outbox.splice(index, 1)
  })
  mocks.updateOutboxRevision.mockImplementation(async (id, writeId, rev, preserveVersion) => {
    const item = outbox.find((entry) => entry.id === id && entry.writeId === writeId)
    if (!item) return
    item.dependsOnWriteId = undefined
    item.payload = {
      ...item.payload,
      rev,
      ...(preserveVersion ? { preserveVersion: true } : {}),
    }
  })
  mocks.setOutboxRecoveryId.mockImplementation(async (id, writeId, recoveryId) => {
    const item = outbox.find((entry) => entry.id === id && entry.writeId === writeId)
    if (item) item.payload = { ...item.payload, recoveryId }
  })
  mocks.advanceOutboxDependents.mockImplementation(async (noteId, sourceWriteId, expectedRev, nextRev) => {
    for (const item of outbox) {
      if (
        item.noteId === noteId &&
        item.dependsOnWriteId === sourceWriteId &&
        item.payload.rev === expectedRev
      ) {
        item.dependsOnWriteId = undefined
        item.payload = { ...item.payload, rev: nextRev }
      }
    }
  })
  return outbox
}

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'ordered-note',
    title: 'Before',
    excerpt: '',
    content: '# Before',
    folderId: null,
    tags: [],
    isPinned: false,
    isStarred: false,
    isArchived: false,
    wordCount: 1,
    charCount: 8,
    rev: 1,
    position: 0,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  }
}

async function waitForCalls(mock: ReturnType<typeof vi.fn>, count: number): Promise<void> {
  await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(count))
}

beforeEach(() => {
  vi.clearAllMocks()
  installMemoryOutbox()
  mocks.markOutboxFailure.mockResolvedValue(undefined)
  mocks.withOutboxReplayLock.mockImplementation(async (_owner: string, task: () => Promise<void>) => {
    await task()
    return true
  })
  useNotes.setState({
    notes: {},
    contents: {},
    saveStatus: 'idle',
    pendingCount: 0,
    online: true,
    cursor: 0,
    folders: [],
    tags: [],
  })
  useUi.setState({ activeNoteId: null, toasts: [] })
})

afterEach(async () => {
  await useNotes.getState().flush({ immediate: true })
})

describe('ordered note mutations', () => {
  it('persists a custom title with the latest body through the offline journal', async () => {
    const initial = note({ id: 'custom-title' })
    const content = '# A heading that is not the title'
    mocks.patch.mockResolvedValueOnce(note({
      ...initial,
      title: 'My custom title',
      content,
      rev: 2,
      updatedAt: 2,
    }))
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    useNotes.getState().editTitle(initial.id, 'My custom title')
    useNotes.getState().editContent(initial.id, content)

    expect(useNotes.getState().notes[initial.id]?.title).toBe('My custom title')
    await useNotes.getState().replayPending()

    expect(mocks.patch).toHaveBeenCalledWith(initial.id, {
      rev: 1,
      title: 'My custom title',
      content,
    })
    expect(useNotes.getState().notes[initial.id]?.title).toBe('My custom title')
    expect(useNotes.getState().contents[initial.id]).toBe(content)
  })

  it('queues an explicitly cleared title instead of falling back to the body heading', async () => {
    const initial = note({ id: 'clear-title', title: 'Old custom title' })
    mocks.patch.mockResolvedValueOnce(note({ ...initial, title: '', rev: 2, updatedAt: 2 }))
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    useNotes.getState().editTitle(initial.id, '')
    await useNotes.getState().replayPending()

    expect(mocks.patch).toHaveBeenCalledWith(initial.id, {
      rev: 1,
      title: '',
    })
    expect(useNotes.getState().notes[initial.id]?.title).toBe('')
  })

  it('rebases a title-only edit without overwriting a newer remote body', async () => {
    const initial = note({ id: 'title-only-rebase' })
    const remote = note({ ...initial, rev: 2, content: '# Remote body', updatedAt: 2 })
    const saved = note({ ...remote, rev: 3, title: 'Local title', updatedAt: 3 })
    mocks.patch
      .mockRejectedValueOnce(new ApiError(409, 'conflict', 'conflict', { server: remote }))
      .mockResolvedValueOnce(saved)
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    useNotes.getState().editTitle(initial.id, 'Local title')
    await useNotes.getState().replayPending()

    expect(mocks.patch.mock.calls).toEqual([
      [initial.id, { rev: 1, title: 'Local title' }],
      [initial.id, { rev: 2, title: 'Local title', preserveVersion: true }],
    ])
    expect(useNotes.getState().notes[initial.id]?.title).toBe('Local title')
    expect(useNotes.getState().contents[initial.id]).toBe('# Remote body')
  })

  it('accepts a foreign-tab title save with the newer remote body and normalized title', async () => {
    const queue = installMemoryOutbox()
    const initial = note({ id: 'foreign-title-result' })
    const saved = note({
      ...initial,
      title: 'Local title',
      content: '# Remote body',
      rev: 3,
      updatedAt: 3,
    })
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    useNotes.getState().editTitle(initial.id, '  Local title  ')
    await vi.waitFor(() => expect(queue).toHaveLength(1))
    const pending = queue[0]!
    queue.splice(0, queue.length)

    acknowledgeOutboxResult({
      type: 'outbox-result',
      clientId: 'foreign-client',
      targetClientId: 'test-client',
      noteId: initial.id,
      writeId: pending.writeId,
      outcome: 'saved',
      rev: saved.rev,
      updatedAt: saved.updatedAt,
      savedTitle: saved.title,
      savedNote: saved,
    })

    expect(useNotes.getState().notes[initial.id]).toMatchObject({ title: 'Local title', rev: 3 })
    expect(useNotes.getState().contents[initial.id]).toBe('# Remote body')
    expect(useNotes.getState().saveStatus).toBe('synced')
  })

  it('uses one network writer while rapid edit and undo overlap a queue replay', async () => {
    installMemoryOutbox()
    const firstSave = deferred<Note>()
    const initial = note({ id: 'rapid-edit-undo' })
    const firstContent = '# First edit'
    const finalContent = initial.content
    mocks.patch
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValueOnce(note({
        id: initial.id,
        rev: 3,
        content: finalContent,
        updatedAt: 3,
      }))
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    useNotes.getState().editContent(initial.id, firstContent)
    const replay = useNotes.getState().replayPending()
    await waitForCalls(mocks.patch, 1)
    expect(mocks.patch.mock.calls[0]?.[1]).toEqual({ rev: 1, content: firstContent })

    useNotes.getState().editContent(initial.id, initial.content)
    useNotes.getState().editContent(initial.id, '# Second edit')
    useNotes.getState().editContent(initial.id, finalContent)
    const flush = useNotes.getState().flush({ immediate: true })

    await Promise.resolve()
    expect(mocks.patch).toHaveBeenCalledTimes(1)

    firstSave.resolve(note({
      id: initial.id,
      rev: 2,
      title: 'First edit',
      content: firstContent,
      updatedAt: 2,
    }))
    await Promise.all([replay, flush])

    expect(mocks.patch).toHaveBeenCalledTimes(2)
    expect(mocks.patch.mock.calls[1]?.[1]).toEqual({ rev: 2, content: finalContent })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(useNotes.getState().contents[initial.id]).toBe(finalContent)
    expect(Object.keys(useNotes.getState().notes)).toEqual([initial.id])
  })

  it('waits for the newest journal write instead of replaying a stale edit', async () => {
    const queue = installMemoryOutbox()
    const initial = note({ id: 'journal-persistence-race' })
    const latest = '# Latest durable edit'
    mocks.patch.mockResolvedValueOnce(note({
      id: initial.id,
      rev: 2,
      title: 'Latest durable edit',
      content: latest,
      updatedAt: 2,
    }))
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    useNotes.getState().editContent(initial.id, '# Stale edit')
    await vi.waitFor(() => expect(queue).toHaveLength(1))

    let releaseLatest!: () => void
    mocks.enqueueOutbox.mockImplementationOnce((item) => new Promise<void>((resolve) => {
      releaseLatest = () => {
        queue.splice(0, queue.length, { ...item, payload: { ...item.payload } })
        resolve()
      }
    }))
    useNotes.getState().editContent(initial.id, latest)
    const replay = useNotes.getState().replayPending()

    await Promise.resolve()
    expect(mocks.patch).not.toHaveBeenCalled()
    releaseLatest()
    await replay

    expect(mocks.patch).toHaveBeenCalledTimes(1)
    expect(mocks.patch).toHaveBeenCalledWith(initial.id, { rev: 1, content: latest })
    expect(useNotes.getState().contents[initial.id]).toBe(latest)
  })

  it('keeps routine reconnect completion silent', async () => {
    const queue = installMemoryOutbox()
    const initial = note({ id: 'silent-reconnect' })
    const saved = note({ id: initial.id, rev: 2, content: '# Offline edit', updatedAt: 2 })
    queue.push({
      id: `patch:old-client:${initial.id}`,
      clientId: 'old-client',
      writeId: 'silent-write',
      noteId: initial.id,
      payload: { content: saved.content, contentDirty: true, rev: 1 },
      attempts: 0,
      createdAt: 1,
    })
    mocks.patch.mockResolvedValueOnce(saved)
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    await useNotes.getState().replayPending()

    expect(queue).toEqual([])
    expect(useUi.getState().toasts).toEqual([])
  })

  it('recreates a missing title-only journal from the durable cache after reload', async () => {
    const initial = note({ id: 'cached-title-recovery' })
    const saved = note({ ...initial, title: 'Recovered title', rev: 2, updatedAt: 2 })
    mocks.getContent.mockResolvedValueOnce({
      content: initial.content,
      contentDirty: false,
      pendingTitle: saved.title,
      rev: 1,
      updatedAt: 2,
      writeId: 'cached-title-write',
    })
    mocks.patch.mockResolvedValueOnce(saved)
    useNotes.setState({ notes: { [initial.id]: initial }, contents: {}, online: false })

    await useNotes.getState().openNote(initial.id)

    expect(useNotes.getState().notes[initial.id]?.title).toBe('Recovered title')
    expect(mocks.enqueueOutbox).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        content: initial.content,
        contentDirty: false,
        rev: 1,
        title: 'Recovered title',
      },
    }))

    await useNotes.getState().flush({ immediate: true })
    expect(mocks.patch).toHaveBeenCalledWith(initial.id, { rev: 1, title: 'Recovered title' })
  })

  it('converges after a long burst of edit and undo requests without changing note identity', async () => {
    const queue = installMemoryOutbox()
    const initial = note({ id: 'edit-undo-stress' })
    let server = initial
    mocks.patch.mockImplementation(async (_id: string, body: PatchNoteBody) => {
      await Promise.resolve()
      if (body.rev !== server.rev) {
        throw new ApiError(409, 'conflict', 'conflict', { server })
      }
      if (body.content === undefined || body.content === server.content) return server
      server = note({
        ...server,
        rev: server.rev + 1,
        title: body.content.replace(/^#\s*/, '').split('\n')[0],
        content: body.content,
        updatedAt: server.updatedAt + 1,
      })
      return server
    })
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    const pending: Promise<void>[] = []
    for (let index = 0; index < 40; index++) {
      const content = index % 2 === 0 ? `# Temporary ${index}` : initial.content
      useNotes.getState().editContent(initial.id, content)
      pending.push(index % 3 === 0
        ? useNotes.getState().flush({ immediate: true })
        : useNotes.getState().replayPending())
    }
    const finalContent = '# Final stable content'
    useNotes.getState().editContent(initial.id, finalContent)
    pending.push(useNotes.getState().flush({ immediate: true }))
    await Promise.all(pending)
    await useNotes.getState().flush({ immediate: true })

    expect(server.content).toBe(finalContent)
    expect(queue).toEqual([])
    expect(mocks.create).not.toHaveBeenCalled()
    expect(Object.keys(useNotes.getState().notes)).toEqual([initial.id])
    expect(useNotes.getState().contents[initial.id]).toBe(finalContent)
    expect(useNotes.getState().pendingCount).toBe(0)
  })

  it('recreates a missing journal from an unconfirmed cached body after reload', async () => {
    const initial = note({ id: 'cached-write-recovery' })
    const saved = note({ id: initial.id, rev: 2, content: '# Pending cache', updatedAt: 2 })
    mocks.getContent.mockResolvedValueOnce({
      content: saved.content,
      rev: 1,
      updatedAt: 2,
      writeId: 'cached-write',
    })
    mocks.patch.mockResolvedValueOnce(saved)
    useNotes.setState({ notes: { [initial.id]: initial }, contents: {}, online: false })

    await useNotes.getState().openNote(initial.id)

    expect(mocks.enqueueOutbox).toHaveBeenCalledWith(expect.objectContaining({
      id: `patch:test-client:${initial.id}`,
      clientId: 'test-client',
      writeId: 'cached-write',
      noteId: initial.id,
      payload: { content: saved.content, contentDirty: true, rev: 1 },
    }))
    expect(useNotes.getState()).toMatchObject({
      contents: { [initial.id]: saved.content },
      saveStatus: 'offline',
      pendingCount: 1,
    })

    await useNotes.getState().flush({ immediate: true })
    expect(mocks.patch).toHaveBeenCalledWith(initial.id, { rev: 1, content: saved.content })
  })

  it('replaces an unreadable matching journal only after a valid recovery is durable', async () => {
    const initial = note({ id: 'corrupt-cached-journal' })
    const corrupt: OutboxItem = {
      id: `patch:other-client:${initial.id}`,
      clientId: 'other-client',
      writeId: 'corrupt-write',
      noteId: initial.id,
      payload: { content: { invalid: true }, rev: 1 },
      attempts: 1,
      createdAt: 2,
    }
    mocks.getContent.mockResolvedValueOnce({
      content: '# Recoverable cache',
      rev: 1,
      updatedAt: 2,
      writeId: corrupt.writeId,
    })
    mocks.getOutbox.mockResolvedValueOnce([corrupt])
    mocks.patch.mockResolvedValueOnce(note({
      id: initial.id,
      content: '# Recoverable cache',
      rev: 2,
      updatedAt: 3,
    }))
    useNotes.setState({ notes: { [initial.id]: initial }, contents: {}, online: false })

    await useNotes.getState().openNote(initial.id)
    await vi.waitFor(() => expect(mocks.completeOutboxItem).toHaveBeenCalledWith(corrupt.id, corrupt.writeId))

    const recovery = mocks.enqueueOutbox.mock.calls[0]?.[0]
    expect(recovery).toMatchObject({
      id: `patch:test-client:${initial.id}`,
      writeId: corrupt.writeId,
      payload: { content: '# Recoverable cache', contentDirty: true, rev: 1 },
    })
    expect(mocks.enqueueOutbox.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.completeOutboxItem.mock.invocationCallOrder[0]!,
    )
    await useNotes.getState().flush({ immediate: true })
  })

  it('keeps a live foreign journal owned and chains edits on its acknowledgement', async () => {
    const initial = note({ id: 'foreign-cached-write' })
    const foreign: OutboxItem = {
      id: `patch:other-client:${initial.id}`,
      clientId: 'other-client',
      writeId: 'foreign-base',
      noteId: initial.id,
      payload: { content: '# Foreign pending', rev: 1 },
      attempts: 0,
      createdAt: 2,
    }
    mocks.getContent.mockResolvedValueOnce({
      content: '# Foreign pending',
      rev: 1,
      updatedAt: 2,
      writeId: foreign.writeId,
    })
    mocks.getOutbox.mockResolvedValueOnce([foreign])
    useNotes.setState({ notes: { [initial.id]: initial }, contents: {}, online: false })

    await useNotes.getState().openNote(initial.id)

    expect(mocks.enqueueOutbox).not.toHaveBeenCalled()
    expect(mocks.completeOutboxItem).not.toHaveBeenCalled()
    expect(useNotes.getState().pendingCount).toBe(1)

    useNotes.getState().editContent(initial.id, '# Continued here')
    const dependent = mocks.enqueueOutbox.mock.calls[0]?.[0]
    expect(dependent).toMatchObject({
      id: `patch:test-client:${initial.id}`,
      dependsOnWriteId: foreign.writeId,
      payload: { content: '# Continued here', rev: 1 },
    })

    await acknowledgeOutboxBaseAdvanced({
      type: 'outbox-base-advanced',
      clientId: 'other-client',
      noteId: initial.id,
      writeId: foreign.writeId,
      expectedRev: 1,
      nextRev: 2,
    })
    const saved = note({ id: initial.id, content: '# Continued here', rev: 3, updatedAt: 3 })
    mocks.patch.mockResolvedValueOnce(saved)
    await useNotes.getState().flush({ immediate: true })

    expect(mocks.advanceOutboxDependents).toHaveBeenCalledWith(initial.id, foreign.writeId, 1, 2)
    expect(mocks.updateOutboxRevision).toHaveBeenCalledWith(dependent?.id, dependent?.writeId, 2)
    expect(mocks.patch).toHaveBeenCalledWith(initial.id, { rev: 2, content: '# Continued here' })
    expect(mocks.completeOutboxItem).not.toHaveBeenCalledWith(foreign.id, foreign.writeId)
  })

  it('replays a persisted dependency before its continuation even when timestamps are tied', async () => {
    const initial = note({ id: 'persisted-dependent-chain' })
    const source: OutboxItem = {
      id: `patch:old-client:${initial.id}`,
      clientId: 'old-client',
      writeId: 'persisted-base',
      noteId: initial.id,
      payload: { content: '# Base', rev: 1 },
      attempts: 0,
      createdAt: 5,
    }
    const dependent: OutboxItem = {
      id: `patch:new-client:${initial.id}`,
      clientId: 'new-client',
      writeId: 'persisted-continuation',
      dependsOnWriteId: source.writeId,
      noteId: initial.id,
      payload: { content: '# Continued', rev: 1 },
      attempts: 0,
      createdAt: 5,
    }
    mocks.getOutbox.mockResolvedValueOnce([dependent, source]).mockResolvedValueOnce([])
    mocks.patch
      .mockResolvedValueOnce(note({ id: initial.id, content: '# Base', rev: 2, updatedAt: 2 }))
      .mockResolvedValueOnce(note({ id: initial.id, content: '# Continued', rev: 3, updatedAt: 3 }))
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    await useNotes.getState().replayPending()

    expect(mocks.patch.mock.calls).toEqual([
      [initial.id, { rev: 1, content: '# Base' }],
      [initial.id, { rev: 2, content: '# Continued' }],
    ])
    expect(mocks.advanceOutboxDependents).toHaveBeenCalledWith(initial.id, source.writeId, 1, 2)
    expect(mocks.completeOutboxItem).toHaveBeenCalledWith(source.id, source.writeId)
    expect(mocks.completeOutboxItem).toHaveBeenCalledWith(dependent.id, dependent.writeId)
  })

  it('routes a dirty note removed by sync through the durable 404 recovery path', async () => {
    const initial = note({ id: 'removed-before-flush' })
    const recovered = note({ id: 'removed-before-flush-copy', content: '# Local survives' })
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })
    useUi.getState().setActiveNote(initial.id)
    useNotes.getState().editContent(initial.id, recovered.content)
    const journal = mocks.enqueueOutbox.mock.calls[0]?.[0]
    expect(journal).toBeDefined()
    mocks.getOutbox.mockResolvedValueOnce([journal!]).mockResolvedValueOnce([])
    mocks.patch.mockRejectedValueOnce(
      new ApiError(404, 'not_found', 'gone', { deletionCursor: 9 }),
    )
    mocks.create.mockResolvedValueOnce(recovered)

    useNotes.setState({ notes: {} })
    await useNotes.getState().flush({ immediate: true })

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^[0-9a-hjkmnp-tv-z]{26}$/),
      content: recovered.content,
      folderId: null,
    }))
    expect(mocks.completeOutboxItem).toHaveBeenCalledWith(journal?.id, journal?.writeId)
    expect(useNotes.getState().notes[recovered.id]).toBeDefined()
    expect(useUi.getState().activeNoteId).toBe(recovered.id)
    expect(useNotes.getState().saveStatus).toBe('synced')
  })

  it('writes every edit to a per-tab durable journal before the network save', async () => {
    const initial = note({ id: 'journaled-note' })
    const saved = note({ id: initial.id, rev: 2, title: 'Journaled', content: '# Journaled', updatedAt: 2 })
    mocks.patch.mockResolvedValueOnce(saved)
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    useNotes.getState().editContent(initial.id, '# Journaled')

    expect(mocks.enqueueOutbox).toHaveBeenCalledTimes(1)
    const journal = mocks.enqueueOutbox.mock.calls[0]?.[0]
    expect(journal).toMatchObject({
      id: `patch:test-client:${initial.id}`,
      clientId: 'test-client',
      noteId: initial.id,
      payload: { content: '# Journaled', rev: 1 },
      attempts: 0,
    })
    expect(journal?.writeId).toEqual(expect.any(String))
    expect(useNotes.getState().pendingCount).toBe(1)

    await useNotes.getState().flush({ immediate: true })
    expect(mocks.completeOutboxItem).toHaveBeenCalledWith(journal?.id, journal?.writeId)
  })

  it('cannot let an older save completion delete a newer journal entry', async () => {
    const first = deferred<Note>()
    const second = deferred<Note>()
    mocks.patch
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const initial = note({ id: 'journal-cas-note' })
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    useNotes.getState().editContent(initial.id, '# First')
    const firstJournal = mocks.enqueueOutbox.mock.calls[0]?.[0]
    const firstFlush = useNotes.getState().flush({ immediate: true })
    await waitForCalls(mocks.patch, 1)

    useNotes.getState().editContent(initial.id, '# Second')
    const secondJournal = mocks.enqueueOutbox.mock.calls[1]?.[0]
    const secondFlush = useNotes.getState().flush({ immediate: true })
    first.resolve(note({ id: initial.id, rev: 2, title: 'First', content: '# First', updatedAt: 2 }))

    await waitForCalls(mocks.patch, 2)
    expect(mocks.completeOutboxItem).toHaveBeenCalledWith(firstJournal?.id, firstJournal?.writeId)
    expect(mocks.updateOutboxRevision).toHaveBeenCalledWith(
      secondJournal?.id,
      secondJournal?.writeId,
      2,
    )
    expect(mocks.patch.mock.calls[1]?.[1]).toEqual({ rev: 2, content: '# Second' })

    second.resolve(note({ id: initial.id, rev: 3, title: 'Second', content: '# Second', updatedAt: 3 }))
    await Promise.all([firstFlush, secondFlush])
    expect(mocks.completeOutboxItem).toHaveBeenCalledWith(secondJournal?.id, secondJournal?.writeId)
    expect(useNotes.getState().contents[initial.id]).toBe('# Second')
  })

  it('treats an identical conflict body as an acknowledged save after response loss', async () => {
    const initial = note({ id: 'lost-save-response' })
    const saved = note({
      id: initial.id,
      rev: 2,
      title: 'Already saved',
      content: '# Already saved',
      updatedAt: 2,
    })
    mocks.patch.mockRejectedValueOnce(
      new ApiError(409, 'conflict', 'conflict', { server: saved }),
    )
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    useNotes.getState().editContent(initial.id, saved.content)
    const journal = mocks.enqueueOutbox.mock.calls[0]?.[0]
    await useNotes.getState().flush({ immediate: true })

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.completeOutboxItem).toHaveBeenCalledWith(journal?.id, journal?.writeId)
    expect(useNotes.getState().notes[initial.id]).toMatchObject({ rev: 2, title: 'Already saved' })
    expect(useNotes.getState().contents[initial.id]).toBe(saved.content)
    expect(useNotes.getState().saveStatus).toBe('synced')
  })

  it('does not create a conflict copy when a foreign journal was already applied', async () => {
    const initial = note({ id: 'foreign-response-loss' })
    const saved = note({ id: initial.id, rev: 2, content: '# Applied once', updatedAt: 2 })
    const journal: OutboxItem = {
      id: `patch:other-client:${initial.id}`,
      clientId: 'other-client',
      writeId: 'already-applied',
      noteId: initial.id,
      payload: { content: saved.content, rev: 1 },
      attempts: 0,
      createdAt: 1,
    }
    mocks.getOutbox.mockResolvedValueOnce([journal]).mockResolvedValueOnce([])
    mocks.patch.mockRejectedValueOnce(
      new ApiError(409, 'conflict', 'conflict', { server: saved }),
    )
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    await useNotes.getState().replayPending()

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.completeOutboxItem).toHaveBeenCalledWith(journal.id, journal.writeId)
    expect(useNotes.getState().notes[initial.id]).toMatchObject({ rev: 2 })
    expect(useNotes.getState().contents[initial.id]).toBe(saved.content)
  })

  it('replays a durable write even when the sync pull is temporarily failing', async () => {
    const initial = note({ id: 'replay-with-sync-down' })
    const saved = note({ id: initial.id, rev: 2, content: '# Offline write', updatedAt: 2 })
    const journal: OutboxItem = {
      id: `patch:old-client:${initial.id}`,
      clientId: 'old-client',
      writeId: 'sync-independent-write',
      noteId: initial.id,
      payload: { content: saved.content, rev: 1 },
      attempts: 0,
      createdAt: 1,
    }
    mocks.sync.mockRejectedValueOnce(new Error('sync unavailable'))
    mocks.getOutbox.mockResolvedValueOnce([journal]).mockResolvedValueOnce([])
    mocks.patch.mockResolvedValueOnce(saved)
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    useNotes.getState().setOnline(true)
    await waitForCalls(mocks.patch, 1)

    expect(mocks.completeOutboxItem).toHaveBeenCalledWith(journal.id, journal.writeId)
    expect(useNotes.getState().notes[initial.id]).toMatchObject({ rev: 2 })
  })

  it('removes a deleted original after this tab recovers its journal as a new note', async () => {
    const initial = note({ id: 'deleted-offline-original' })
    const recovered = note({ id: 'deleted-offline-copy', content: '# Recovered', title: 'Recovered' })
    const journal: OutboxItem = {
      id: `patch:test-client:${initial.id}`,
      clientId: 'test-client',
      writeId: 'deleted-write',
      noteId: initial.id,
      payload: { content: recovered.content, rev: 1 },
      attempts: 0,
      createdAt: 1,
    }
    mocks.getOutbox.mockResolvedValueOnce([journal]).mockResolvedValueOnce([])
    mocks.patch.mockRejectedValueOnce(
      new ApiError(404, 'not_found', 'gone', { deletionCursor: 7 }),
    )
    mocks.create.mockResolvedValueOnce(recovered)
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })
    useUi.setState({ activeNoteId: initial.id })

    await useNotes.getState().replayPending()

    expect(useNotes.getState().notes[initial.id]).toBeUndefined()
    expect(useNotes.getState().contents[initial.id]).toBeUndefined()
    expect(useNotes.getState().notes[recovered.id]).toBeDefined()
    expect(useUi.getState().activeNoteId).toBe(recovered.id)
    expect(mocks.dropContent).toHaveBeenCalledWith(initial.id)
  })

  it('rebases a real remote conflict in place and never creates a duplicate note', async () => {
    const initial = note({ id: 'recovery-ack-retry' })
    const remote = note({ id: initial.id, rev: 2, content: '# Remote', updatedAt: 2 })
    const saved = note({
      id: initial.id,
      rev: 3,
      content: '# Local offline',
      title: 'Local offline',
      updatedAt: 3,
    })
    const journal: OutboxItem = {
      id: `patch:foreign-client:${initial.id}`,
      clientId: 'foreign-client',
      writeId: 'recovery-needs-ack',
      noteId: initial.id,
      payload: { content: saved.content, rev: 1 },
      attempts: 0,
      createdAt: 1,
    }
    const queue = installMemoryOutbox()
    queue.push(journal)
    mocks.patch
      .mockRejectedValueOnce(new ApiError(409, 'conflict', 'conflict', { server: remote }))
      .mockResolvedValueOnce(saved)
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    await useNotes.getState().replayPending()

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.patch.mock.calls.map((call) => call[1])).toEqual([
      { rev: 1, content: saved.content },
      { rev: 2, content: saved.content, preserveVersion: true },
    ])
    expect(mocks.completeOutboxItem).toHaveBeenCalledTimes(1)
    expect(queue).toEqual([])
    expect(Object.keys(useNotes.getState().notes)).toEqual([initial.id])
    expect(useNotes.getState().contents[initial.id]).toBe(saved.content)
  })

  it('never turns a malformed local journal payload into server note content', async () => {
    const invalid: OutboxItem = {
      id: 'patch:broken',
      clientId: 'old-client',
      writeId: 'broken-write',
      noteId: 'must-not-change',
      payload: { content: { unexpected: true }, rev: 1 },
      attempts: 0,
      createdAt: 1,
    }
    mocks.getOutbox.mockResolvedValue([invalid])

    await useNotes.getState().replayPending()

    expect(mocks.patch).not.toHaveBeenCalled()
    expect(mocks.markOutboxFailure).toHaveBeenCalledWith(
      invalid.id,
      invalid.writeId,
      'invalid offline journal payload',
    )
  })

  it('commits a full snapshot and its catch-up changes in one visible state', async () => {
    const stale = note({ id: 'full-sync-note', rev: 1, title: 'Stale', updatedAt: 1 })
    const current = note({ id: stale.id, rev: 2, title: 'Current', updatedAt: 2 })
    const response = (overrides: Partial<SyncResponse>): SyncResponse => ({
      cursor: 10,
      full: false,
      hasMore: false,
      nextKey: null,
      facetsFull: false,
      settingsChanged: false,
      notes: [],
      folders: [],
      tags: [],
      deletions: [],
      serverTime: 10,
      ...overrides,
    })
    mocks.sync
      .mockResolvedValueOnce(response({ full: true, facetsFull: true, notes: [stale] }))
      .mockResolvedValueOnce(response({ cursor: 11, notes: [current], serverTime: 11 }))

    const observedRevisions: number[] = []
    const unsubscribe = useNotes.subscribe((state, previous) => {
      if (state.notes !== previous.notes && state.notes[stale.id]) {
        observedRevisions.push(state.notes[stale.id]!.rev)
      }
    })
    try {
      await useNotes.getState().pull({ force: true })
      expect(observedRevisions).toEqual([2])
      expect(useNotes.getState()).toMatchObject({ cursor: 11 })
      expect(useNotes.getState().notes[stale.id]).toMatchObject({ rev: 2, title: 'Current' })
    } finally {
      unsubscribe()
    }
  })

  it('refreshes the public user when sync reports a profile change', () => {
    const refresh = vi.spyOn(useSession.getState(), 'refresh').mockResolvedValue()
    try {
      useNotes.getState().applySync({
        cursor: 12,
        full: false,
        hasMore: false,
        nextKey: null,
        facetsFull: false,
        settingsChanged: false,
        profileChanged: true,
        notes: [],
        folders: [],
        tags: [],
        deletions: [],
        serverTime: 12,
      })

      expect(refresh).toHaveBeenCalledOnce()
    } finally {
      refresh.mockRestore()
    }
  })

  it('never regresses a confirmed summary when an older sync response arrives', () => {
    const current = note({ id: 'late-sync-note', rev: 5, title: 'Current', updatedAt: 5 })
    const stale = note({ id: current.id, rev: 4, title: 'Stale', updatedAt: 4 })
    useNotes.setState({ notes: { [current.id]: current }, contents: { [current.id]: current.content } })

    useNotes.getState().applySync({
      cursor: 8,
      full: false,
      hasMore: false,
      nextKey: null,
      facetsFull: false,
      settingsChanged: false,
      notes: [stale],
      folders: [],
      tags: [],
      deletions: [],
      serverTime: 8,
    })

    expect(useNotes.getState().notes[current.id]).toBe(current)
  })

  it('discards a folder-list response that arrives after newer sync state', async () => {
    const stale: Folder = {
      id: 'folder-race',
      parentId: null,
      name: 'Old name',
      icon: null,
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const current: Folder = { ...stale, name: 'Current name', updatedAt: 2 }
    const response = deferred<{ folders: Folder[] }>()
    mocks.listFolders.mockImplementationOnce(() => response.promise)
    useNotes.setState({ folders: [stale] })

    const refresh = useNotes.getState().refreshFolders()
    useNotes.getState().applySync({
      cursor: 3,
      full: false,
      hasMore: false,
      nextKey: null,
      facetsFull: false,
      settingsChanged: false,
      notes: [],
      folders: [current],
      tags: [],
      deletions: [],
      serverTime: 3,
    })
    response.resolve({ folders: [stale] })
    await refresh

    expect(useNotes.getState().folders).toEqual([current])
  })

  it('serially rebases two tabs onto one note without producing conflict copies', async () => {
    const initial = note({ id: 'cross-tab-offline' })
    const remote = note({ id: initial.id, rev: 2, title: 'Remote', content: '# Remote', updatedAt: 2 })
    const foreignSaved = note({ id: initial.id, rev: 3, title: 'Foreign', content: '# Foreign offline', updatedAt: 3 })
    const localSaved = note({ id: initial.id, rev: 4, title: 'Local', content: '# Local offline', updatedAt: 4 })
    const foreignJournal = {
      id: `patch:other-client:${initial.id}`,
      clientId: 'other-client',
      writeId: 'foreign-write',
      noteId: initial.id,
      payload: { content: '# Foreign offline', rev: 1 },
      attempts: 0,
      createdAt: 1,
    }
    mocks.sync.mockResolvedValueOnce({
      cursor: 2,
      full: false,
      hasMore: false,
      nextKey: null,
      facetsFull: false,
      settingsChanged: false,
      notes: [remote],
      folders: [],
      tags: [],
      deletions: [],
      serverTime: 2,
    })
    const queue = installMemoryOutbox()
    queue.push(foreignJournal)
    mocks.patch
      .mockRejectedValueOnce(new ApiError(409, 'conflict', 'conflict', { server: remote }))
      .mockResolvedValueOnce(foreignSaved)
      .mockRejectedValueOnce(new ApiError(409, 'conflict', 'conflict', { server: foreignSaved }))
      .mockResolvedValueOnce(localSaved)
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })
    useNotes.getState().editContent(initial.id, '# Local offline')

    useNotes.getState().setOnline(true)
    await vi.waitFor(() => expect(queue).toEqual([]))

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.patch.mock.calls.map((call) => call[1])).toEqual([
      { rev: 1, content: '# Foreign offline' },
      { rev: 2, content: '# Foreign offline', preserveVersion: true },
      { rev: 1, content: '# Local offline' },
      { rev: 3, content: '# Local offline', preserveVersion: true },
    ])
    expect(useNotes.getState().contents[initial.id]).toBe('# Local offline')
    expect(Object.keys(useNotes.getState().notes)).toEqual([initial.id])
  })

  it('retries a metadata click that races with a body replay instead of reverting it', async () => {
    const bodyRequest = deferred<Note>()
    const metadataRequest = deferred<Note>()
    const initial = note({ id: 'metadata-body-race' })
    const bodySaved = note({
      id: initial.id,
      rev: 2,
      title: 'Latest body',
      content: '# Latest body',
      updatedAt: 2,
    })
    const fullySaved = note({
      ...bodySaved,
      rev: 3,
      isStarred: true,
      updatedAt: 3,
    })
    mocks.patch
      .mockImplementationOnce(() => bodyRequest.promise)
      .mockImplementationOnce(() => metadataRequest.promise)
      .mockResolvedValueOnce(fullySaved)
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    useNotes.getState().editContent(initial.id, bodySaved.content)
    const flushing = useNotes.getState().flush({ immediate: true })
    await waitForCalls(mocks.patch, 1)

    const starring = useNotes.getState().patchNote(initial.id, { isStarred: true })
    await waitForCalls(mocks.patch, 2)
    expect(mocks.patch.mock.calls[1]?.[1]).toEqual({ rev: 1, isStarred: true })

    bodyRequest.resolve(bodySaved)
    metadataRequest.reject(new ApiError(409, 'conflict', 'conflict', { server: bodySaved }))

    await waitForCalls(mocks.patch, 3)
    expect(mocks.patch.mock.calls[2]?.[1]).toEqual({ rev: 2, isStarred: true })
    await Promise.all([flushing, starring])

    expect(useNotes.getState().notes[initial.id]).toMatchObject({ rev: 3, isStarred: true })
    expect(useNotes.getState().contents[initial.id]).toBe(bodySaved.content)
    expect(useUi.getState().toasts).toEqual([])
  })

  it('serializes metadata and content writes without reverting a later optimistic click', async () => {
    const first = deferred<Note>()
    const second = deferred<Note>()
    const contentSave = deferred<Note>()
    mocks.patch
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => contentSave.promise)

    const initial = note()
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })
    useNotes.getState().editContent(initial.id, '# Latest\n\nbody #2 #1')

    const observed: Array<[boolean, boolean]> = []
    const unsubscribe = useNotes.subscribe((state) => {
      const current = state.notes[initial.id]
      if (current) observed.push([current.isStarred, current.isPinned])
    })

    try {
      const star = useNotes.getState().patchNote(initial.id, { isStarred: true })
      const pin = useNotes.getState().patchNote(initial.id, { isPinned: true })
      expect(useNotes.getState().notes[initial.id]).toMatchObject({ isStarred: true, isPinned: true })

      await waitForCalls(mocks.patch, 1)
      expect(mocks.patch.mock.calls[0]?.[1]).toEqual({ rev: 1, isStarred: true })
      first.resolve(note({ rev: 2, isStarred: true, content: '# Before', updatedAt: 2 }))

      await waitForCalls(mocks.patch, 2)
      expect(mocks.patch.mock.calls[1]?.[1]).toEqual({ rev: 2, isPinned: true })
      expect(useNotes.getState().notes[initial.id]).toMatchObject({ isStarred: true, isPinned: true })
      second.resolve(note({ rev: 3, isStarred: true, isPinned: true, content: '# Before', updatedAt: 3 }))
      await Promise.all([star, pin])

      const flush = useNotes.getState().flush({ immediate: true })
      await waitForCalls(mocks.patch, 3)
      const contentBody = mocks.patch.mock.calls[2]?.[1] as PatchNoteBody
      expect(contentBody).toEqual({ rev: 3, content: '# Latest\n\nbody #2 #1' })
      contentSave.resolve(note({
        rev: 4,
        title: 'Latest',
        excerpt: 'body #2 #1',
        content: '# Latest\n\nbody #2 #1',
        tags: ['1', '2'],
        isStarred: true,
        isPinned: true,
        updatedAt: 4,
      }))
      await flush

      const firstFullyOptimistic = observed.findIndex(([starred, pinned]) => starred && pinned)
      expect(firstFullyOptimistic).toBeGreaterThanOrEqual(0)
      expect(observed.slice(firstFullyOptimistic).every(([starred, pinned]) => starred && pinned)).toBe(true)
      expect(useNotes.getState().notes[initial.id]).toMatchObject({ rev: 4, isStarred: true, isPinned: true })
      expect(useNotes.getState().contents[initial.id]).toBe('# Latest\n\nbody #2 #1')
    } finally {
      unsubscribe()
    }
  })

  it('saves the latest dirty source before trashing and keeps the optimistic trash state stable', async () => {
    const contentSave = deferred<Note>()
    const removal = deferred<Note>()
    mocks.patch.mockImplementationOnce(() => contentSave.promise)
    mocks.remove.mockImplementationOnce(() => removal.promise)

    const initial = note({ id: 'delete-after-save' })
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })
    useUi.setState({ activeNoteId: initial.id })
    useNotes.getState().editContent(initial.id, '# Must survive')

    const deletedStates: Array<number | null> = []
    const unsubscribe = useNotes.subscribe((state) => {
      const current = state.notes[initial.id]
      if (current) deletedStates.push(current.deletedAt)
    })

    try {
      const removing = useNotes.getState().deleteNote(initial.id)
      expect(useUi.getState().activeNoteId).toBeNull()
      expect(useNotes.getState().notes[initial.id]?.deletedAt).not.toBeNull()

      await waitForCalls(mocks.patch, 1)
      expect(mocks.remove).not.toHaveBeenCalled()
      expect(mocks.patch.mock.calls[0]?.[1]).toEqual({ rev: 1, content: '# Must survive' })
      contentSave.resolve(note({ id: initial.id, rev: 2, content: '# Must survive', title: 'Must survive', updatedAt: 2 }))

      await waitForCalls(mocks.remove, 1)
      expect(useNotes.getState().notes[initial.id]?.deletedAt).not.toBeNull()
      removal.resolve(note({
        id: initial.id,
        rev: 3,
        content: '# Must survive',
        title: 'Must survive',
        deletedAt: 3,
        updatedAt: 3,
      }))
      await removing

      const firstDeleted = deletedStates.findIndex((value) => value !== null)
      expect(firstDeleted).toBeGreaterThanOrEqual(0)
      expect(deletedStates.slice(firstDeleted).every((value) => value !== null)).toBe(true)
      expect(useNotes.getState().contents[initial.id]).toBe('# Must survive')
      expect(useNotes.getState().notes[initial.id]).toMatchObject({ rev: 3, deletedAt: 3 })
    } finally {
      unsubscribe()
    }
  })

  it('recovers unsaved content as a new note when the original was deleted elsewhere', async () => {
    const initial = note({ id: 'deleted-on-another-device' })
    const recovered = note({
      id: 'recovered-copy',
      rev: 1,
      title: 'Recovered locally',
      content: '# Unsaved local work',
      updatedAt: 10,
    })
    mocks.patch.mockRejectedValueOnce(new ApiError(404, 'not_found', 'Note not found'))
    mocks.create.mockResolvedValueOnce(recovered)
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })
    useUi.setState({ activeNoteId: initial.id })
    useNotes.getState().editContent(initial.id, '# Unsaved local work')

    await useNotes.getState().flush({ immediate: true })

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^[0-9a-hjkmnp-tv-z]{26}$/),
      content: '# Unsaved local work',
      folderId: null,
    }))
    expect(useNotes.getState().notes[initial.id]).toBeUndefined()
    expect(useNotes.getState().contents[initial.id]).toBeUndefined()
    expect(useNotes.getState().notes[recovered.id]).toBeDefined()
    expect(useNotes.getState().contents[recovered.id]).toBe('# Unsaved local work')
    expect(useUi.getState().activeNoteId).toBe(recovered.id)
  })

  it('reuses one durable recovery id when the recovery response is lost', async () => {
    const initial = note({ id: 'deleted-recovery-response-loss' })
    const content = '# Recover exactly once'
    mocks.patch
      .mockRejectedValueOnce(new ApiError(404, 'not_found', 'Note not found', { deletionCursor: 12 }))
      .mockRejectedValueOnce(new ApiError(404, 'not_found', 'Note not found', { deletionCursor: 12 }))
    mocks.create
      .mockRejectedValueOnce(new ApiError(0, 'offline', 'response lost'))
      .mockImplementationOnce(async (body: { id?: string }) => note({
        id: body.id,
        title: 'Recover exactly once',
        content,
        updatedAt: 10,
      }))
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })
    useUi.setState({ activeNoteId: initial.id })
    useNotes.getState().editContent(initial.id, content)

    await useNotes.getState().flush({ immediate: true })
    await useNotes.getState().flush({ immediate: true })

    expect(mocks.create).toHaveBeenCalledTimes(2)
    const firstRecoveryId = mocks.create.mock.calls[0]?.[0]?.id
    expect(firstRecoveryId).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/)
    expect(mocks.create.mock.calls[1]?.[0]?.id).toBe(firstRecoveryId)
    expect(useNotes.getState().notes[initial.id]).toBeUndefined()
    expect(Object.keys(useNotes.getState().notes)).toEqual([firstRecoveryId])
    expect(useNotes.getState().contents[firstRecoveryId]).toBe(content)
  })

  it('drops cached source after a full sync confirms a hard deletion', () => {
    const initial = note({ id: 'purged-remotely' })
    useNotes.setState({ notes: { [initial.id]: initial }, contents: { [initial.id]: initial.content } })

    useNotes.getState().applySync({
      cursor: 9,
      full: true,
      hasMore: false,
      nextKey: null,
      facetsFull: true,
      settingsChanged: false,
      notes: [],
      folders: [],
      tags: [],
      deletions: [],
      serverTime: 10,
    })

    expect(useNotes.getState().notes[initial.id]).toBeUndefined()
    expect(mocks.dropContent).toHaveBeenCalledWith(initial.id)
  })

  it('does not resurrect a locally purged note from a stale full snapshot', async () => {
    const initial = note({ id: 'locally-purged', deletedAt: 5 })
    mocks.purge.mockResolvedValueOnce({ ok: true, cursor: 12 })
    useNotes.setState({
      notes: { [initial.id]: initial },
      contents: { [initial.id]: initial.content },
      cursor: 10,
    })

    await useNotes.getState().purgeNote(initial.id)
    useNotes.getState().applySync({
      cursor: 11,
      full: false,
      hasMore: false,
      nextKey: null,
      facetsFull: false,
      settingsChanged: false,
      notes: [initial],
      folders: [],
      tags: [],
      deletions: [],
      serverTime: 11,
    })
    expect(useNotes.getState().notes[initial.id]).toBeUndefined()

    useNotes.getState().applySync({
      cursor: 12,
      full: true,
      hasMore: false,
      nextKey: null,
      facetsFull: true,
      settingsChanged: false,
      notes: [initial],
      folders: [],
      tags: [],
      deletions: [],
      serverTime: 12,
    })

    expect(useNotes.getState().notes[initial.id]).toBeUndefined()
    expect(useNotes.getState().contents[initial.id]).toBeUndefined()

    const recreated = note({ id: initial.id, rev: 1, title: 'Recreated', content: '# Recreated', deletedAt: null, updatedAt: 20 })
    useNotes.getState().applySync({
      cursor: 13,
      full: false,
      hasMore: false,
      nextKey: null,
      facetsFull: false,
      settingsChanged: false,
      notes: [recreated],
      folders: [],
      tags: [],
      deletions: [],
      serverTime: 13,
    })
    expect(useNotes.getState().notes[initial.id]).toMatchObject({ title: 'Recreated' })
  })

  it('invalidates a note body request that finishes after permanent deletion', async () => {
    const pendingBody = deferred<Note>()
    const initial = note({ id: 'purge-request-race', deletedAt: 5 })
    mocks.get.mockImplementationOnce(() => pendingBody.promise)
    mocks.purge.mockResolvedValueOnce({ ok: true, cursor: 8 })
    useNotes.setState({ notes: { [initial.id]: initial }, contents: {} })

    const opening = useNotes.getState().openNote(initial.id)
    await waitForCalls(mocks.get, 1)
    await useNotes.getState().purgeNote(initial.id)
    pendingBody.resolve(initial)
    await opening

    expect(useNotes.getState().notes[initial.id]).toBeUndefined()
    expect(useNotes.getState().contents[initial.id]).toBeUndefined()
  })

  it('invalidates a local cached body read that finishes after permanent deletion', async () => {
    const cachedBody = deferred<{ content: string; rev: number; updatedAt: number } | undefined>()
    const initial = note({ id: 'purge-cache-race' })
    mocks.getContent.mockImplementationOnce(() => cachedBody.promise)
    useNotes.setState({ notes: { [initial.id]: initial }, contents: {} })

    const opening = useNotes.getState().openNote(initial.id)
    await Promise.resolve()
    useNotes.getState().applySync({
      cursor: 9,
      full: false,
      hasMore: false,
      nextKey: null,
      facetsFull: false,
      settingsChanged: false,
      notes: [],
      folders: [],
      tags: [],
      deletions: [{ entity: 'note', id: initial.id }],
      serverTime: 9,
    })
    cachedBody.resolve({ content: initial.content, rev: initial.rev, updatedAt: initial.updatedAt })
    await opening

    expect(useNotes.getState().notes[initial.id]).toBeUndefined()
    expect(useNotes.getState().contents[initial.id]).toBeUndefined()
    expect(useUi.getState().activeNoteId).not.toBe(initial.id)
  })
})
