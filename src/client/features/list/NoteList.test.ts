import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { NoteSummary } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ui: {
    view: 'all',
    folderId: null as string | null,
    tag: null as string | null,
    sort: 'updated',
    order: 'desc',
    density: 'comfortable',
    activeNoteId: '01K00000000000000000000000' as string | null,
    selectedIds: [
      '01K00000000000000000000000',
      '01K00000000000000000000001',
    ],
    setSort: vi.fn(),
    toggleNavDrawer: vi.fn(),
    setSelected: vi.fn(),
    toggleSelected: vi.fn(),
    toast: vi.fn(),
  },
  notes: {} as Record<string, NoteSummary>,
  patchNote: vi.fn(),
  deleteNote: vi.fn(),
  restoreNote: vi.fn(),
  purgeNote: vi.fn(),
  duplicateNote: vi.fn(),
  createNote: vi.fn(),
  openNote: vi.fn(),
  pull: vi.fn(),
  emptyTrash: vi.fn(),
}))

vi.mock('../../store/ui', () => {
  const useUi = (selector: (state: unknown) => unknown) => selector(mocks.ui)
  useUi.getState = () => mocks.ui
  return { useUi }
})

vi.mock('../../store/notes', () => {
  const state = {
    get notes() { return mocks.notes },
    folders: [],
    loading: false,
    hydrated: true,
    patchNote: mocks.patchNote,
    deleteNote: mocks.deleteNote,
    restoreNote: mocks.restoreNote,
    purgeNote: mocks.purgeNote,
    duplicateNote: mocks.duplicateNote,
    createNote: mocks.createNote,
    openNote: mocks.openNote,
    pull: mocks.pull,
  }
  const useNotes = (selector: (value: unknown) => unknown) => selector(state)
  useNotes.getState = () => state
  return {
    useNotes,
    useVisibleNotes: () => Object.values(mocks.notes),
  }
})

vi.mock('../../lib/api', () => ({
  api: { notes: { emptyTrash: mocks.emptyTrash } },
}))

vi.mock('../../lib/hooks', async () => {
  const actual = await vi.importActual<typeof import('../../lib/hooks')>('../../lib/hooks')
  return { ...actual, useBreakpoint: () => 'desktop' }
})

vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
  useLocale: () => 'en-US',
  localeTag: () => 'en-US',
}))

import { NoteList } from './NoteList'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
  mocks.notes = {
    '01K00000000000000000000000': note('01K00000000000000000000000', 'First'),
    '01K00000000000000000000001': note('01K00000000000000000000001', 'Second'),
  }
  mocks.ui.activeNoteId = '01K00000000000000000000000'
  mocks.ui.selectedIds = Object.keys(mocks.notes)
  mocks.ui.view = 'all'
  mocks.pull.mockResolvedValue(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('bulk note actions', () => {
  it('refreshes visible note ages as time passes', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-01-01T12:00:30Z').getTime()
    vi.setSystemTime(now)
    const only = note('01K00000000000000000000000', 'First')
    only.updatedAt = now - 30_000
    mocks.notes = { [only.id]: only }
    mocks.ui.selectedIds = [only.id]
    const { root } = await renderList()

    expect(document.body.textContent).toContain('time.just_now')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })
    expect(document.body.textContent).toContain('1 minute ago')

    await act(async () => root.unmount())
  })

  it('exposes and highlights a single selected row even when it is not active', async () => {
    mocks.ui.selectedIds = ['01K00000000000000000000001']
    const { root } = await renderList()
    const selected = document.querySelector<HTMLElement>(
      '[data-note-id="01K00000000000000000000001"]',
    )!

    expect(selected.getAttribute('aria-selected')).toBe('true')
    expect(selected.className).toContain('accent-soft')

    await act(async () => root.unmount())
  })

  it('runs once and restores selection around the current active note', async () => {
    const pending = deferred<void>()
    mocks.patchNote
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(undefined)
    const { root } = await renderList()

    await act(async () => {
      const favorite = buttonByLabel('navigation.favorites')
      favorite.click()
      favorite.click()
      await flushPromises()
    })
    expect(mocks.patchNote).toHaveBeenCalledTimes(1)

    mocks.ui.activeNoteId = '01K00000000000000000000001'
    await act(async () => {
      pending.resolve()
      await pending.promise
      await flushPromises()
    })

    expect(mocks.patchNote).toHaveBeenCalledTimes(2)
    expect(mocks.ui.setSelected).toHaveBeenLastCalledWith([
      '01K00000000000000000000001',
    ])

    await act(async () => root.unmount())
  })

  it('queues only one permanent deletion for repeated menu activation', async () => {
    const pending = deferred<void>()
    mocks.purgeNote.mockReturnValueOnce(pending.promise)
    const trashed = note('01K00000000000000000000000', 'Trashed')
    trashed.deletedAt = 2
    mocks.notes = { [trashed.id]: trashed }
    mocks.ui.view = 'trash'
    mocks.ui.selectedIds = [trashed.id]
    const { root } = await renderList()

    const row = document.querySelector<HTMLElement>(`[data-note-id="${trashed.id}"]`)!
    await act(async () => {
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: 20,
        clientY: 20,
      }))
      await flushPromises()
    })

    await act(async () => {
      const button = buttonWithText('notes.delete_permanently')
      button.click()
      button.click()
      await flushPromises()
    })
    expect(mocks.purgeNote).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve()
      await pending.promise
      await flushPromises()
      root.unmount()
    })
  })
})

async function renderList() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(NoteList))
    await flushPromises()
  })
  return { root }
}

function buttonByLabel(label: string): HTMLButtonElement {
  const matches = [...document.body.querySelectorAll(`[aria-label="${label}"]`)]
  const match = matches.find((candidate) => candidate instanceof HTMLButtonElement && !candidate.closest('[role="option"]'))
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
  return match
}

function buttonWithText(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.includes(label))
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
  return match
}

function note(id: string, title: string): NoteSummary {
  return {
    id,
    title,
    excerpt: '',
    folderId: null,
    tags: [],
    isPinned: false,
    isStarred: false,
    isArchived: false,
    wordCount: 1,
    charCount: 1,
    rev: 1,
    position: 1,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
