import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  stats: vi.fn(),
  save: vi.fn(),
  importFiles: vi.fn(),
  prune: vi.fn(),
  emptyTrash: vi.fn(),
  reindex: vi.fn(),
  pull: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: {
    settings: { stats: mocks.stats },
    transfer: { save: mocks.save, import: mocks.importFiles },
    files: { prune: mocks.prune },
    notes: { emptyTrash: mocks.emptyTrash },
    reindex: mocks.reindex,
  },
}))

vi.mock('../../store/ui', () => ({
  useUi: (selector: (state: { toast: typeof mocks.toast }) => unknown) =>
    selector({ toast: mocks.toast }),
}))

vi.mock('../../store/notes', () => ({
  useNotes: (selector: (state: { pull: typeof mocks.pull }) => unknown) =>
    selector({ pull: mocks.pull }),
}))

vi.mock('../../components/overlay', () => ({ confirm: vi.fn() }))
vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
  localeTag: () => 'en-US',
}))

import { DataSettings } from './DataSettings'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  mocks.stats.mockResolvedValue({ notes: 1 })
  mocks.save.mockResolvedValue(undefined)
  mocks.importFiles.mockResolvedValue({
    createdNotes: 1,
    updatedNotes: 0,
    skippedNotes: 0,
    createdFolders: 0,
    createdAttachments: 0,
    skippedAttachments: 0,
    warnings: [],
  })
  mocks.pull.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('data settings mutation lifecycle', () => {
  it('shows a retryable error instead of zero statistics when the overview request fails', async () => {
    mocks.stats
      .mockRejectedValueOnce(new Error('stats offline'))
      .mockResolvedValueOnce({ notes: 7 })
    const { container, root } = await renderSettings()

    expect(container.textContent).toContain('settings.could_not_load_data_overview')
    expect(container.textContent).toContain('stats offline')
    expect(container.textContent).not.toContain('common.note')

    await act(async () => {
      button(container, 'common.retry').click()
      await flushPromises()
    })

    expect(mocks.stats).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('settings.could_not_load_data_overview')
    expect(container.textContent).toContain('common.note')
    expect(container.textContent).toContain('7')

    await act(async () => root.unmount())
  })

  it('reports a completed import separately when the follow-up refresh fails', async () => {
    mocks.pull.mockRejectedValueOnce(new Error('refresh failed'))
    const { container, root } = await renderSettings()

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['# Imported'], 'note.md', { type: 'text/markdown' })],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await flushPromises()
    })

    expect(mocks.importFiles).toHaveBeenCalledOnce()
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'settings.import_completed',
      description: expect.stringContaining('settings.operation_completed_but_refresh_failed'),
      tone: 'warning',
    }))
    expect(mocks.stats.mock.calls.length).toBeGreaterThanOrEqual(2)

    await act(async () => root.unmount())
  })

  it('disables the other data actions while one operation is still running', async () => {
    const pending = deferred<void>()
    mocks.save.mockReturnValueOnce(pending.promise)
    const { container, root } = await renderSettings()

    await act(async () => {
      button(container, 'settings.download_zip').click()
      await flushPromises()
    })

    expect(button(container, 'settings.download_json').disabled).toBe(true)
    expect(button(container, 'settings.select_file').disabled).toBe(true)
    expect(button(container, 'settings.rebuild_index').disabled).toBe(true)

    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    await act(async () => root.unmount())
  })

  it('does not start a statistics refresh after an import finishes on an unmounted panel', async () => {
    const pending = deferred<{
      createdNotes: number
      updatedNotes: number
      skippedNotes: number
      createdFolders: number
      createdAttachments: number
      skippedAttachments: number
      warnings: string[]
    }>()
    mocks.importFiles.mockReturnValueOnce(pending.promise)
    const { container, root } = await renderSettings()
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['# Imported'], 'note.md', { type: 'text/markdown' })],
    })

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await flushPromises()
      root.unmount()
    })
    pending.resolve({
      createdNotes: 1,
      updatedNotes: 0,
      skippedNotes: 0,
      createdFolders: 0,
      createdAttachments: 0,
      skippedAttachments: 0,
      warnings: [],
    })
    await pending.promise
    await flushPromises()

    expect(mocks.stats).toHaveBeenCalledOnce()
  })
})

async function renderSettings() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(DataSettings))
    await flushPromises()
  })
  return { container, root }
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.includes(label))
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
  return match
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
