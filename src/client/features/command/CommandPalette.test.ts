import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { NoteSummary, SearchResponse } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  openNote: vi.fn(),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  patchNote: vi.fn(),
  refreshFolders: vi.fn(),
  openPanel: vi.fn(),
  openView: vi.fn(),
  updateSettings: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: {
    search: mocks.search,
    folders: { create: vi.fn() },
    transfer: { save: vi.fn() },
  },
}))

vi.mock('../../store/notes', () => ({
  useNotes: (selector: (state: unknown) => unknown) => selector({
    notes: {},
    tags: [],
    folders: [],
    openNote: mocks.openNote,
    createNote: mocks.createNote,
    deleteNote: mocks.deleteNote,
    patchNote: mocks.patchNote,
    refreshFolders: mocks.refreshFolders,
  }),
}))

vi.mock('../../store/ui', () => ({
  useUi: Object.assign(
    (selector: (state: unknown) => unknown) => selector({
      activeNoteId: null,
      recentNoteIds: [],
      openPanel: mocks.openPanel,
      openView: mocks.openView,
    }),
    { getState: () => ({ toast: mocks.toast }) },
  ),
}))

vi.mock('../../store/session', () => ({
  useSession: (selector: (state: unknown) => unknown) => selector({
    settings: { appearance: { theme: 'light' } },
    updateSettings: mocks.updateSettings,
  }),
}))

vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
  useLocale: () => 'en-US',
  localeTag: () => 'en-US',
}))

import { CommandPalette } from './CommandPalette'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  if (originalScrollIntoView) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView)
  } else {
    delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
  }
  document.body.replaceChildren()
})

describe('command palette search lifecycle', () => {
  it('hides results from the previous query as soon as the input changes', async () => {
    mocks.search.mockResolvedValue(searchResponse('alpha'))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(createElement(CommandPalette, { onClose: vi.fn() }))
      })
      const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!
      await changeInput(input, 'alpha')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(180)
        await flushPromises()
      })

      expect(document.body.textContent).toContain('Remote note')

      await changeInput(input, 'beta')
      expect(document.body.textContent).not.toContain('Remote note')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})

function searchResponse(text: string): SearchResponse {
  return {
    results: [{ note: note(), snippet: `contains ${text}`, score: 1 }],
    mode: 'fts',
    took: 1,
    query: { text, tags: [], folder: null, starred: null, archived: null },
  }
}

function note(): NoteSummary {
  return {
    id: '01K00000000000000000000000',
    title: 'Remote note',
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

async function changeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
  })
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
