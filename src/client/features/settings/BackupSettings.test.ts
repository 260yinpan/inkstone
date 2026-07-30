import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { BackupRun, BackupTarget, TestConnectionResult } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  targets: vi.fn(),
  runs: vi.fn(),
  run: vi.fn(),
  patch: vi.fn(),
  test: vi.fn(),
  remove: vi.fn(),
  create: vi.fn(),
  testDraft: vi.fn(),
  updateSettings: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../lib/api', () => {
  class MockApiError extends Error {}
  return {
    ApiError: MockApiError,
    api: {
      backup: {
        targets: mocks.targets,
        runs: mocks.runs,
        run: mocks.run,
        patch: mocks.patch,
        test: mocks.test,
        remove: mocks.remove,
        create: mocks.create,
        testDraft: mocks.testDraft,
      },
    },
  }
})

vi.mock('../../store/session', () => ({
  useSession: (selector: (state: unknown) => unknown) => selector({
    settings: { backup: { schedule: 'off' } },
    updateSettings: mocks.updateSettings,
  }),
}))

vi.mock('../../store/ui', () => ({
  useUi: (selector: (state: unknown) => unknown) => selector({ toast: mocks.toast }),
}))

vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
  translateServiceMessage: (message: string | null | undefined) => message ?? '',
  localeTag: () => 'en-US',
}))

import { BackupSettings } from './BackupSettings'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  mocks.targets.mockResolvedValue({ targets: [target()] })
  mocks.runs.mockResolvedValue({ runs: [] })
  mocks.patch.mockResolvedValue(target())
  mocks.remove.mockResolvedValue({ ok: true })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('backup action exclusivity', () => {
  it('starts only one manual backup for rapid repeated clicks', async () => {
    const pending = deferred<BackupRun>()
    mocks.run.mockReturnValueOnce(pending.promise)
    const { root } = await renderSettings()

    await act(async () => {
      const button = buttonWithText('settings.back_up_now')
      button.click()
      button.click()
      await flushPromises()
    })
    expect(mocks.run).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve(run())
      await pending.promise
      await flushPromises()
    })

    await act(async () => root.unmount())
  })

  it('starts only one target test for rapid repeated clicks', async () => {
    const pending = deferred<TestConnectionResult>()
    mocks.test.mockReturnValueOnce(pending.promise)
    const { root } = await renderSettings()

    await act(async () => {
      const button = buttonWithText('settings.test')
      button.click()
      button.click()
      await flushPromises()
    })
    expect(mocks.test).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve({ ok: true, message: 'ok', latencyMs: 1 })
      await pending.promise
      await flushPromises()
    })

    await act(async () => root.unmount())
  })

  it('clears a connection result after the tested configuration changes', async () => {
    mocks.test.mockResolvedValueOnce({ ok: true, message: 'connection-ok', latencyMs: 1 })
    const { root } = await renderSettings()

    await act(async () => {
      buttonByLabel('common.edit').click()
      await flushPromises()
    })
    await act(async () => {
      buttonWithExactText('settings.test_connection').click()
      await flushPromises()
    })
    expect(document.body.textContent).toContain('connection-ok')
    expect(document.body.querySelector('[role="status"]')?.textContent).toContain('connection-ok')

    const bucket = [...document.body.querySelectorAll<HTMLInputElement>('input')]
      .find((input) => input.value === 'notes')
    expect(bucket).toBeInstanceOf(HTMLInputElement)
    await changeInput(bucket!, 'changed-bucket')

    expect(document.body.textContent).not.toContain('connection-ok')
    await act(async () => root.unmount())
  })

  it('locks the target form while its current values are being tested', async () => {
    const pending = deferred<TestConnectionResult>()
    mocks.test.mockReturnValueOnce(pending.promise)
    const { root } = await renderSettings()

    await act(async () => {
      buttonByLabel('common.edit').click()
      await flushPromises()
    })
    const bucket = [...document.body.querySelectorAll<HTMLInputElement>('input')]
      .find((input) => input.value === 'notes')!

    await act(async () => {
      buttonWithExactText('settings.test_connection').click()
      await flushPromises()
    })
    expect(bucket.matches(':disabled')).toBe(true)
    expect(bucket.closest('fieldset')?.getAttribute('aria-busy')).toBe('true')

    await act(async () => {
      pending.resolve({ ok: true, message: 'ok', latencyMs: 1 })
      await pending.promise
      await flushPromises()
    })
    expect(bucket.matches(':disabled')).toBe(false)
    await act(async () => root.unmount())
  })
})

async function renderSettings() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(BackupSettings))
    await flushPromises()
  })
  return { root }
}

function buttonWithText(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.includes(label))
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
  return match
}

function buttonWithExactText(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
  return match
}

function buttonByLabel(label: string): HTMLButtonElement {
  const match = document.body.querySelector(`[aria-label="${label}"]`)
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
  return match
}

async function changeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
  })
}

function target(): BackupTarget {
  return {
    id: '01K00000000000000000000000',
    type: 's3',
    name: 'Primary',
    enabled: true,
    config: {
      endpoint: 'https://storage.example.com',
      region: 'auto',
      bucket: 'notes',
      prefix: 'inkstone',
      pathStyle: true,
      mode: 'archive',
    },
    hasSecret: true,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

function run(): BackupRun {
  return {
    id: '01K00000000000000000000001',
    trigger: 'manual',
    status: 'success',
    startedAt: 1,
    finishedAt: 2,
    noteCount: 1,
    fileCount: 1,
    bytes: 10,
    results: [],
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
