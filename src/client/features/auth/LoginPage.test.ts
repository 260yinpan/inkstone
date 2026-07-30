import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { SiteInfo } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  passwordLogin: vi.fn(),
  passwordRegister: vi.fn(),
  authError: null as string | null,
}))

vi.mock('../../store/session', () => ({
  useSession: (selector: (state: unknown) => unknown) => selector({
    site: site(),
    authError: mocks.authError,
    passwordLogin: mocks.passwordLogin,
    passwordRegister: mocks.passwordRegister,
  }),
}))

vi.mock('../../lib/api', () => ({
  ApiError: class MockApiError extends Error {},
}))

vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
}))

import { LoginPage } from './LoginPage'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  mocks.authError = null
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('login submission lifecycle', () => {
  it('shows the current submission error instead of an older session-load error', async () => {
    mocks.authError = 'stale session error'
    mocks.passwordLogin.mockRejectedValueOnce(new Error('request failed'))
    const { root } = await renderPage()

    await changeInput(inputByLabel('common.username'), 'alice')
    await changeInput(inputByLabel('common.password'), 'secret')
    await act(async () => {
      buttonWithText('auth.sign_in').click()
      await flushPromises()
    })

    expect(document.body.textContent).toContain('auth.network_error_try_again')
    expect(document.body.textContent).not.toContain('stale session error')
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      'auth.network_error_try_again',
    )
    await act(async () => root.unmount())
  })

  it('sends only one login request for rapid repeated submissions', async () => {
    const pending = deferred<void>()
    mocks.passwordLogin.mockReturnValueOnce(pending.promise)
    const { root } = await renderPage()

    const username = inputByLabel('common.username')
    const password = inputByLabel('common.password')
    await changeInput(username, ' alice ')
    await changeInput(password, 'secret')

    await act(async () => {
      const submit = buttonWithText('auth.sign_in')
      submit.click()
      submit.click()
      await flushPromises()
    })

    expect(mocks.passwordLogin).toHaveBeenCalledTimes(1)
    expect(mocks.passwordLogin).toHaveBeenCalledWith('alice', 'secret')
    expect(username.disabled).toBe(true)
    expect(password.disabled).toBe(true)

    await act(async () => {
      pending.resolve()
      await pending.promise
      await flushPromises()
      root.unmount()
    })
  })
})

async function renderPage() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(LoginPage))
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

function inputByLabel(label: string): HTMLInputElement {
  const match = document.body.querySelector(`[aria-label="${label}"]`)
  if (!(match instanceof HTMLInputElement)) throw new Error(`Missing input: ${label}`)
  return match
}

function buttonWithText(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.includes(label))
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
  return match
}

function site(): SiteInfo {
  return {
    name: 'Inkstone',
    initialized: true,
    registrationOpen: false,
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
