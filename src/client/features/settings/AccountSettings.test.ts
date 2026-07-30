import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { PublicUser, SiteInfo } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: null as PublicUser | null,
  site: null as SiteInfo | null,
  updateProfile: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  setPassword: vi.fn(),
  updateRegistration: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('../../store/session', () => ({
  useSession: (selector: (state: unknown) => unknown) => selector({
    user: mocks.user,
    site: mocks.site,
    updateProfile: mocks.updateProfile,
    refresh: mocks.refresh,
    logout: mocks.logout,
  }),
}))

vi.mock('../../store/ui', () => ({
  useUi: (selector: (state: unknown) => unknown) => selector({ toast: mocks.toast }),
}))

vi.mock('../../components/overlay', () => ({ confirm: mocks.confirm }))

vi.mock('../../lib/api', () => {
  class MockApiError extends Error {}
  return {
    ApiError: MockApiError,
    api: {
      auth: {
        setPassword: mocks.setPassword,
        updateRegistration: mocks.updateRegistration,
      },
    },
  }
})

vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
}))

vi.mock('./AvatarPicker', () => ({ AvatarPicker: () => null }))

import { AccountSettings } from './AccountSettings'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  mocks.user = user('Owner')
  mocks.site = site(false)
  mocks.refresh.mockResolvedValue(undefined)
  mocks.logout.mockResolvedValue(undefined)
  mocks.setPassword.mockResolvedValue({ ok: true })
  mocks.updateRegistration.mockResolvedValue({ ok: true, registrationOpen: true })
  mocks.confirm.mockResolvedValue(false)
})

afterEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('account settings mutation lifecycle', () => {
  it('opens only one logout confirmation for rapid repeated clicks', async () => {
    const pending = deferred<boolean>()
    mocks.confirm.mockReturnValueOnce(pending.promise)
    const { root } = await renderSettings()

    await act(async () => {
      const button = buttonWithText('common.exit')
      button.click()
      button.click()
      await flushPromises()
    })

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(buttonWithText('common.exit').disabled).toBe(true)

    await act(async () => {
      pending.resolve(true)
      await pending.promise
      await flushPromises()
    })
    expect(mocks.logout).toHaveBeenCalledOnce()

    await act(async () => root.unmount())
  })

  it('submits a display-name change only once for rapid repeated clicks', async () => {
    const pending = deferred<PublicUser>()
    mocks.updateProfile.mockReturnValueOnce(pending.promise)
    const { root } = await renderSettings()

    const input = document.querySelector<HTMLInputElement>('#profile-display-name')!
    await changeInput(input, 'Updated Owner')

    await act(async () => {
      const button = buttonWithText('common.save')
      button.click()
      button.click()
      await flushPromises()
    })
    expect(mocks.updateProfile).toHaveBeenCalledTimes(1)
    expect(mocks.updateProfile).toHaveBeenCalledWith({ name: 'Updated Owner' })

    await act(async () => {
      pending.resolve(user('Updated Owner'))
      await pending.promise
      await flushPromises()
    })

    await act(async () => root.unmount())
  })

  it('does not report a completed registration change as failed when refresh fails', async () => {
    mocks.refresh.mockRejectedValueOnce(new Error('offline'))
    const { root } = await renderSettings()

    await act(async () => {
      switchButton().click()
      await flushPromises()
    })
    const password = document.querySelector<HTMLInputElement>('input[type="password"]')!
    await changeInput(password, 'correct horse')

    await act(async () => {
      buttonWithText('settings.confirm_opening_registration').click()
      await flushPromises()
    })

    expect(mocks.updateRegistration).toHaveBeenCalledWith(true, 'correct horse')
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'settings.registration_open',
      tone: 'success',
    }))
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'settings.operation_completed_but_refresh_failed',
      tone: 'warning',
    }))
    expect(document.body.textContent).not.toContain('settings.action_failed_try_again')

    await act(async () => root.unmount())
  })

  it('closes a stale registration confirmation when another session already applied it', async () => {
    const { root } = await renderSettings()

    await act(async () => {
      switchButton().click()
      await flushPromises()
    })
    expect(document.body.querySelector('input[type="password"]')).not.toBeNull()

    mocks.site = site(true)
    await act(async () => {
      root.render(createElement(AccountSettings))
      await flushPromises()
    })

    expect(document.body.querySelector('input[type="password"]')).toBeNull()
    expect(mocks.updateRegistration).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
})

async function renderSettings() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(AccountSettings))
    await flushPromises()
  })
  return { root }
}

async function changeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
  })
}

function buttonWithText(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.includes(label))
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
  return match
}

function switchButton(): HTMLButtonElement {
  const match = document.body.querySelector('[role="switch"]')
  if (!(match instanceof HTMLButtonElement)) throw new Error('Missing registration switch')
  return match
}

function user(name: string): PublicUser {
  return {
    id: '01K00000000000000000000000',
    login: 'owner',
    username: 'owner',
    name,
    avatarUrl: '',
    role: 'owner',
    createdAt: 1,
  }
}

function site(registrationOpen: boolean): SiteInfo {
  return {
    name: 'Inkstone',
    initialized: true,
    registrationOpen,
    r2Enabled: false,
    kvEnabled: false,
    attachmentStorage: null,
    realtimeEnabled: false,
    version: '0.1.0',
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
