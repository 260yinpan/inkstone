import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  notes: {
    online: true,
    lastSavedAt: 0,
    pendingCount: 0,
    pull: vi.fn(),
    replayPending: vi.fn(),
  },
  toast: vi.fn(),
  updateSettings: vi.fn(),
}))

vi.mock('../../store/session', () => ({
  useSession: (selector: (state: unknown) => unknown) => selector({
    settings: { sync: { realtime: true, pollIntervalMs: 15_000 } },
    site: { realtimeEnabled: true },
    updateSettings: mocks.updateSettings,
  }),
}))

vi.mock('../../store/notes', () => {
  const useNotes = (selector: (state: unknown) => unknown) => selector(mocks.notes)
  useNotes.getState = () => mocks.notes
  return { useNotes }
})

vi.mock('../../store/ui', () => ({
  useUi: (selector: (state: unknown) => unknown) => selector({ toast: mocks.toast }),
}))

vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
  localeTag: () => 'en-US',
}))

import { SyncSettings } from './SyncSettings'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  mocks.notes.online = true
  mocks.notes.pull.mockResolvedValue(undefined)
  mocks.notes.replayPending.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('manual synchronization', () => {
  it('runs only once while pending and reports success after replay', async () => {
    const pending = deferred<void>()
    mocks.notes.pull.mockReturnValueOnce(pending.promise)
    const { root } = await renderSettings()
    const sync = buttonWithText('settings.sync_now')

    await act(async () => {
      sync.click()
      sync.click()
      await Promise.resolve()
    })

    expect(mocks.notes.pull).toHaveBeenCalledOnce()
    expect(sync.disabled).toBe(true)

    await act(async () => {
      pending.resolve()
      await pending.promise
      await flushPromises()
    })

    expect(mocks.notes.replayPending).toHaveBeenCalledOnce()
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'settings.reloaded_all_data',
      tone: 'success',
    })
    await act(async () => root.unmount())
  })

  it('does not claim success when the pull detects an offline connection', async () => {
    mocks.notes.pull.mockImplementationOnce(async () => {
      mocks.notes.online = false
    })
    const { root } = await renderSettings()

    await act(async () => {
      buttonWithText('settings.sync_now').click()
      await flushPromises()
    })

    expect(mocks.toast).toHaveBeenCalledWith({ title: 'settings.offline', tone: 'warning' })
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }))
    await act(async () => root.unmount())
  })

  it('still replays local writes when pulling remote changes fails', async () => {
    mocks.notes.pull.mockRejectedValueOnce(new Error('pull failed'))
    const { root } = await renderSettings()

    await act(async () => {
      buttonWithText('settings.sync_now').click()
      await flushPromises()
    })

    expect(mocks.notes.replayPending).toHaveBeenCalledOnce()
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'common.action_failed',
      description: 'pull failed',
      tone: 'danger',
    })
    await act(async () => root.unmount())
  })
})

async function renderSettings() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(createElement(SyncSettings)))
  return { root }
}

function buttonWithText(label: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.includes(label))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
  return button
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
