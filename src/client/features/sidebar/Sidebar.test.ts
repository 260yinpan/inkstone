import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { FolderNode } from '../../store/notes'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ui: {
    view: 'folder',
    folderId: '01K00000000000000000000000' as string | null,
    expandedFolders: [] as string[],
    openView: vi.fn(),
    expandFolder: vi.fn(),
    toggleFolder: vi.fn(),
    openPanel: vi.fn(),
    toast: vi.fn(),
  },
  tree: [] as FolderNode[],
  tags: [] as Array<{ id: string; name: string; color: string | null; count: number; createdAt: number }>,
  refreshFolders: vi.fn(),
  patchNote: vi.fn(),
  deleteNote: vi.fn(),
  createNote: vi.fn(),
  removeFolder: vi.fn(),
  patchFolder: vi.fn(),
  createFolder: vi.fn(),
  updateSettings: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('../../store/ui', () => {
  const useUi = (selector: (state: unknown) => unknown) => selector(mocks.ui)
  useUi.getState = () => mocks.ui
  return { useUi }
})

vi.mock('../../store/notes', () => {
  const state = () => ({
    tags: mocks.tags,
    refreshFolders: mocks.refreshFolders,
    patchNote: mocks.patchNote,
    deleteNote: mocks.deleteNote,
    createNote: mocks.createNote,
  })
  const useNotes = (selector: (value: unknown) => unknown) => selector(state())
  useNotes.getState = state
  return {
    useNotes,
    useFolderTree: () => mocks.tree,
    useNavigationCounts: () => ({
      all: 0,
      starred: 0,
      unfiled: 0,
      archived: 0,
      trash: 0,
    }),
  }
})

vi.mock('../../store/session', () => ({
  useSession: (selector: (state: unknown) => unknown) => selector({
    user: null,
    settings: { appearance: { theme: 'system' } },
    updateSettings: mocks.updateSettings,
    logout: mocks.logout,
  }),
}))

vi.mock('../../lib/api', () => ({
  api: {
    folders: {
      remove: mocks.removeFolder,
      patch: mocks.patchFolder,
      create: mocks.createFolder,
    },
  },
}))

vi.mock('../../lib/hooks', async () => {
  const actual = await vi.importActual<typeof import('../../lib/hooks')>('../../lib/hooks')
  return { ...actual, useBreakpoint: () => 'desktop' }
})

vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
}))

import { Sidebar } from './Sidebar'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  mocks.ui.view = 'folder'
  mocks.ui.folderId = '01K00000000000000000000000'
  Object.assign(mocks.ui, { tag: null, activeNoteId: null })
  mocks.tree = [folderNode()]
  mocks.tags.length = 0
  mocks.refreshFolders.mockResolvedValue(undefined)
  mocks.createFolder.mockResolvedValue({ id: '01K11111111111111111111111' })
  mocks.patchFolder.mockResolvedValue({})
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('folder deletion navigation', () => {
  it('does not leave the user\'s newer view when an old deletion finishes', async () => {
    const pending = deferred<{ ok: true }>()
    mocks.removeFolder.mockReturnValueOnce(pending.promise)
    const { root } = await renderSidebar()

    await act(async () => {
      buttonByLabel('common.more_actions').click()
      await flushPromises()
    })
    await act(async () => {
      buttonWithText('sidebar.delete_folder').click()
      await flushPromises()
    })
    expect(mocks.removeFolder).toHaveBeenCalledWith(
      '01K00000000000000000000000',
      'move-up',
    )

    mocks.ui.view = 'all'
    mocks.ui.folderId = null
    await act(async () => {
      root.render(createElement(Sidebar))
      await flushPromises()
    })

    await act(async () => {
      pending.resolve({ ok: true })
      await pending.promise
      await flushPromises()
    })

    expect(mocks.ui.openView).not.toHaveBeenCalledWith('all')
    await act(async () => root.unmount())
  })
})

describe('folder action lifecycle', () => {
  it('keeps the button menu and context menu mutually exclusive', async () => {
    const { root } = await renderSidebar()

    await act(async () => {
      buttonByLabel('common.more_actions').click()
      await flushPromises()
    })
    expect(document.body.querySelectorAll('[role="menu"]')).toHaveLength(1)

    const row = document.body.querySelector('[draggable="true"]')
    expect(row).not.toBeNull()
    await act(async () => {
      row!.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: 40,
        clientY: 50,
      }))
      await flushPromises()
    })

    expect(document.body.querySelectorAll('[role="menu"]')).toHaveLength(1)

    await act(async () => {
      buttonByLabel('common.more_actions').click()
      await flushPromises()
    })
    expect(document.body.querySelectorAll('[role="menu"]')).toHaveLength(1)
    await act(async () => root.unmount())
  })

  it('starts only one folder creation and does not steal newer navigation', async () => {
    const pending = deferred<{ id: string }>()
    mocks.tree = []
    mocks.createFolder.mockReturnValueOnce(pending.promise)
    const { root } = await renderSidebar()
    const create = buttonWithText('sidebar.create_first_folder')

    await act(async () => {
      create.click()
      create.click()
      await flushPromises()
    })

    expect(mocks.createFolder).toHaveBeenCalledOnce()
    expect(create.disabled).toBe(true)

    mocks.ui.view = 'all'
    mocks.ui.folderId = null
    await act(async () => {
      pending.resolve({ id: '01K11111111111111111111111' })
      await pending.promise
      await flushPromises()
    })

    expect(mocks.ui.openView).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('submits a folder rename only once when completion events overlap', async () => {
    const pending = deferred<Record<string, never>>()
    mocks.patchFolder.mockReturnValueOnce(pending.promise)
    const { root } = await renderSidebar()

    await act(async () => {
      buttonByLabel('common.more_actions').click()
      await flushPromises()
    })
    await act(async () => {
      buttonWithText('sidebar.rename').click()
      await flushPromises()
    })

    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="sidebar.rename"]')!
    input.value = 'Renamed'
    await act(async () => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await flushPromises()
    })

    expect(mocks.patchFolder).toHaveBeenCalledOnce()
    expect(mocks.patchFolder).toHaveBeenCalledWith(
      '01K00000000000000000000000',
      { name: 'Renamed' },
    )

    await act(async () => {
      pending.resolve({})
      await pending.promise
      await flushPromises()
      root.unmount()
    })
  })
})

describe('sidebar details', () => {
  it('does not render an empty tag section for unused tags', async () => {
    mocks.tags.push({ id: 'unused', name: 'unused', color: null, count: 0, createdAt: 1 })
    const { root } = await renderSidebar()

    expect(document.body.textContent).not.toContain('navigation.tag')
    await act(async () => root.unmount())
  })

  it('keeps every native sidebar button non-submitting and hides empty expand controls', async () => {
    const { root } = await renderSidebar()

    const buttons = [...document.body.querySelectorAll('button')]
    expect(buttons.length).toBeGreaterThan(0)
    expect(buttons.every((button) => button.type === 'button')).toBe(true)
    const hiddenExpand = buttons.find((button) => button.getAttribute('aria-hidden') === 'true')
    expect(hiddenExpand?.disabled).toBe(true)
    await act(async () => root.unmount())
  })
})

async function renderSidebar() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(Sidebar))
    await flushPromises()
  })
  return { root }
}

function buttonByLabel(label: string): HTMLButtonElement {
  const match = document.body.querySelector(`[aria-label="${label}"]`)
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
  return match
}

function buttonWithText(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.includes(label))
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
  return match
}

function folderNode(): FolderNode {
  return {
    id: '01K00000000000000000000000',
    parentId: null,
    name: 'Folder',
    icon: null,
    position: 1,
    createdAt: 1,
    updatedAt: 1,
    children: [],
    depth: 0,
    totalNotes: 1,
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
