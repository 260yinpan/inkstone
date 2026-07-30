import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GITHUB_REPOSITORY_URL } from '@shared/constants'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('../../components/overlay', () => ({ confirm: mocks.confirm }))

vi.mock('../../store/session', () => ({
  useSession: (selector: (state: unknown) => unknown) => selector({
    user: {
      id: 'user',
      username: 'alice',
      name: 'Alice',
      avatarUrl: '',
      role: 'owner',
      createdAt: 1,
    },
    site: { registrationOpen: false, version: '0.1.0' },
    logout: mocks.logout,
  }),
}))

vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
  localeTag: () => 'en-US',
}))

import { AboutSettings } from './AboutSettings'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  mocks.logout.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('account exit', () => {
  it('opens only one confirmation while a logout attempt is pending', async () => {
    const pending = deferred<boolean>()
    mocks.confirm.mockReturnValueOnce(pending.promise)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(createElement(AboutSettings)))
    const exit = buttonWithText('common.exit')

    await act(async () => {
      exit.click()
      exit.click()
      await Promise.resolve()
    })

    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(exit.disabled).toBe(true)

    await act(async () => {
      pending.resolve(false)
      await pending.promise
      await Promise.resolve()
    })

    expect(mocks.logout).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
})

describe('product links', () => {
  it('opens the planned GitHub repository from the product card', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(createElement(AboutSettings)))

    const link = document.body.querySelector<HTMLAnchorElement>(`a[href="${GITHUB_REPOSITORY_URL}"]`)
    expect(link).not.toBeNull()
    expect(link?.target).toBe('_blank')
    expect(link?.rel.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
    expect(link?.getAttribute('aria-label')).toBe('settings.open_github_repository')

    await act(async () => root.unmount())
  })
})

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
