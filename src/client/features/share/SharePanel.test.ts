import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { NoteSummary, ShareInfo } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  note: null as NoteSummary | null,
  getShare: vi.fn(),
  createShare: vi.fn(),
  removeShare: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../lib/api', () => {
  class MockApiError extends Error {}
  return {
    ApiError: MockApiError,
    api: {
      share: {
        get: mocks.getShare,
        create: mocks.createShare,
        remove: mocks.removeShare,
      },
    },
  }
})

vi.mock('../../store/ui', () => ({
  useUi: (selector: (state: { toast: typeof mocks.toast }) => unknown) =>
    selector({ toast: mocks.toast }),
}))

vi.mock('../../store/notes', () => ({
  useActiveNote: () => ({ note: mocks.note, content: '', loaded: true }),
}))

vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
  localeTag: () => 'en-US',
}))

import { SharePanel } from './SharePanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  mocks.note = note('01K00000000000000000000000', 'First')
  mocks.getShare.mockResolvedValue({ share: null })
  mocks.removeShare.mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('share panel request lifecycle', () => {
  it('does not treat a failed status request as an unshared note', async () => {
    mocks.getShare.mockRejectedValueOnce(new Error('status unavailable'))
    const { root } = await renderPanel()

    expect(document.body.textContent).toContain('share.could_not_load_sharing_status')
    expect(document.body.textContent).toContain('status unavailable')
    expect(actionButton('share.generate_public_link').disabled).toBe(true)

    await act(async () => {
      actionButton('common.retry').click()
      await flushPromises()
    })

    expect(mocks.getShare).toHaveBeenCalledTimes(2)
    expect(actionButton('share.generate_public_link').disabled).toBe(false)
    await act(async () => root.unmount())
  })

  it('keeps link creation disabled until the current share state has loaded', async () => {
    const pending = deferred<{ share: null }>()
    mocks.getShare.mockReturnValueOnce(pending.promise)
    const { root } = await renderPanel(false)

    expect(actionButton('share.generate_public_link').disabled).toBe(true)

    await act(async () => {
      pending.resolve({ share: null })
      await pending.promise
    })
    expect(actionButton('share.generate_public_link').disabled).toBe(false)

    await act(async () => root.unmount())
  })

  it('cannot let an old note mutation replace the newly selected note state', async () => {
    const oldCreate = deferred<{ share: ShareInfo }>()
    mocks.createShare.mockReturnValueOnce(oldCreate.promise)
    const { root } = await renderPanel()

    await act(async () => {
      actionButton('share.generate_public_link').click()
      await flushPromises()
    })
    expect(mocks.createShare).toHaveBeenCalledWith(
      '01K00000000000000000000000',
      expect.any(Object),
    )

    mocks.note = note('01K00000000000000000000001', 'Second')
    await act(async () => {
      root.render(createElement(SharePanel, { onClose: vi.fn() }))
      await flushPromises()
    })

    await act(async () => {
      oldCreate.resolve({ share: share('https://example.test/s/old-note') })
      await oldCreate.promise
      await flushPromises()
    })

    expect(document.body.textContent).not.toContain('https://example.test/s/old-note')
    expect(actionButton('share.generate_public_link').disabled).toBe(false)
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({
      title: 'share.public_link_created',
    }))

    await act(async () => root.unmount())
  })

  it('locks sharing controls while an update is in flight', async () => {
    const pending = deferred<{ share: ShareInfo }>()
    mocks.createShare.mockReturnValueOnce(pending.promise)
    const { root } = await renderPanel()

    await act(async () => {
      actionButton('share.generate_public_link').click()
      await flushPromises()
    })

    expect(document.body.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true)
    expect(
      [...document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]')].every(
        (radio) => radio.disabled,
      ),
    ).toBe(true)

    await act(async () => {
      pending.resolve({ share: share('https://example.test/s/current-note') })
      await pending.promise
      await flushPromises()
      root.unmount()
    })
  })
})

async function renderPanel(flush = true) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(SharePanel, { onClose: vi.fn() }))
    if (flush) await flushPromises()
  })
  return { root }
}

function actionButton(label: string): HTMLButtonElement {
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

function share(url: string): ShareInfo {
  return {
    slug: 'old-note',
    noteId: '01K00000000000000000000000',
    url,
    hasPassword: false,
    expiresAt: null,
    views: 0,
    createdAt: 1,
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
