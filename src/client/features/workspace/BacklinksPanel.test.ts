import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  backlinks: vi.fn(),
  openNote: vi.fn(),
  cursor: 0,
}))

vi.mock('../../lib/api', () => ({
  api: { notes: { backlinks: mocks.backlinks } },
}))

vi.mock('../../store/notes', () => ({
  useNotes: (selector: (state: unknown) => unknown) => selector({
    openNote: mocks.openNote,
    notes: { note: { rev: 1 } },
    cursor: mocks.cursor,
  }),
}))

vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
}))

import { BacklinksPanel } from './BacklinksPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  mocks.cursor = 0
  mocks.backlinks.mockResolvedValue({ backlinks: [] })
})

afterEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('backlink loading', () => {
  it('shows a failed request separately from an empty backlink list', async () => {
    mocks.backlinks.mockRejectedValueOnce(new Error('offline'))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(BacklinksPanel, { noteId: 'note' }))
      await flushPromises()
    })

    expect(document.body.textContent).toContain('workspace.could_not_load_backlinks')
    expect(document.body.textContent).not.toContain('workspace.no_notes_link_here_yet_write')

    const retry = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent === 'common.retry')
    expect(retry).toBeInstanceOf(HTMLButtonElement)
    await act(async () => {
      retry!.click()
      await flushPromises()
    })

    expect(mocks.backlinks).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('workspace.no_notes_link_here_yet_write')
    await act(async () => root.unmount())
  })

  it('reloads when synchronization advances because another note can change the backlinks', async () => {
    mocks.backlinks
      .mockResolvedValueOnce({ backlinks: [] })
      .mockResolvedValueOnce({
        backlinks: [{ id: 'source', title: 'Source', context: '[[Target]]' }],
      })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(BacklinksPanel, { noteId: 'note' }))
      await flushPromises()
    })
    expect(mocks.backlinks).toHaveBeenCalledTimes(1)

    mocks.cursor = 2
    await act(async () => {
      root.render(createElement(BacklinksPanel, { noteId: 'note' }))
      await flushPromises()
    })

    expect(mocks.backlinks).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('Source')
    expect(container.querySelector('button')?.type).toBe('button')
    await act(async () => root.unmount())
  })
})

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
