import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { NoteSummary, NoteVersion } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  note: null as NoteSummary | null,
  versions: vi.fn(),
  version: vi.fn(),
  restoreVersion: vi.fn(),
  openNote: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: {
    notes: {
      versions: mocks.versions,
      version: mocks.version,
      restoreVersion: mocks.restoreVersion,
    },
  },
}))

vi.mock('../../store/ui', () => ({
  useUi: (selector: (state: { toast: typeof mocks.toast }) => unknown) =>
    selector({ toast: mocks.toast }),
}))

vi.mock('../../store/notes', () => ({
  useActiveNote: () => ({ note: mocks.note, content: '# Current', loaded: true }),
  useNotes: (selector: (state: { openNote: typeof mocks.openNote }) => unknown) =>
    selector({ openNote: mocks.openNote }),
}))

vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
  localeTag: () => 'en-US',
}))

import { VersionsPanel } from './VersionsPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  mocks.note = note('01K00000000000000000000000', 'First')
  mocks.versions.mockResolvedValue({ versions: [versionMeta('version-1')] })
  mocks.version.mockResolvedValue(version('version-1'))
  mocks.openNote.mockResolvedValue(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('version restore lifecycle', () => {
  it('keeps restore disabled until the selected version body is loaded', async () => {
    const pending = deferred<NoteVersion>()
    mocks.version.mockReturnValueOnce(pending.promise)
    const { root } = await renderPanel(vi.fn())

    expect(restoreButton().disabled).toBe(true)

    await act(async () => {
      pending.resolve(version('version-1'))
      await pending.promise
      await flushPromises()
    })

    expect(restoreButton().disabled).toBe(false)
    await act(async () => root.unmount())
  })

  it('shows version loading failures separately and retries them', async () => {
    mocks.version.mockRejectedValueOnce(new Error('version unavailable'))
    const { root } = await renderPanel(vi.fn())

    expect(document.body.textContent).toContain('workspace.could_not_load_version')
    expect(document.body.textContent).toContain('version unavailable')
    expect(restoreButton().disabled).toBe(true)

    await act(async () => {
      buttonWithText('common.retry').click()
      await flushPromises()
    })

    expect(mocks.version).toHaveBeenCalledTimes(2)
    expect(restoreButton().disabled).toBe(false)
    await act(async () => root.unmount())
  })

  it('allows only one restore while an operation is pending', async () => {
    const pending = deferred<void>()
    mocks.restoreVersion.mockReturnValueOnce(pending.promise)
    const onClose = vi.fn()
    const { root } = await renderPanel(onClose)

    await act(async () => {
      const button = restoreButton()
      button.click()
      button.click()
      await flushPromises()
    })

    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.restoreVersion).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve()
      await pending.promise
      await flushPromises()
    })
    expect(mocks.openNote).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => root.unmount())
  })

  it('ignores an old restore response after the active note changes', async () => {
    const pending = deferred<void>()
    mocks.restoreVersion.mockReturnValueOnce(pending.promise)
    const onClose = vi.fn()
    const { root } = await renderPanel(onClose)

    await act(async () => {
      restoreButton().click()
      await flushPromises()
    })
    expect(mocks.restoreVersion).toHaveBeenCalledWith(
      '01K00000000000000000000000',
      'version-1',
    )

    mocks.note = note('01K00000000000000000000001', 'Second')
    await act(async () => {
      root.render(createElement(VersionsPanel, { onClose }))
      await flushPromises()
    })

    await act(async () => {
      pending.resolve()
      await pending.promise
      await flushPromises()
    })

    expect(mocks.openNote).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => root.unmount())
  })
})

async function renderPanel(onClose: () => void) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(VersionsPanel, { onClose }))
    await flushPromises()
  })
  return { root }
}

function restoreButton(): HTMLButtonElement {
  const match = [...document.body.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.includes('workspace.restore_this_version_da5169'))
  if (!(match instanceof HTMLButtonElement)) throw new Error('Missing restore button')
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
    wordCount: 0,
    charCount: 0,
    rev: 1,
    position: 1,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  }
}

function versionMeta(id: string) {
  return {
    id,
    noteId: '01K00000000000000000000000',
    title: 'First',
    size: 10,
    createdAt: 1,
  }
}

function version(id: string): NoteVersion {
  return {
    ...versionMeta(id),
    content: '# Previous',
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
