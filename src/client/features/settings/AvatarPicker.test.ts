import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { PublicUser } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../store/session', () => ({
  useSession: (selector: (state: unknown) => unknown) => selector({
    updateProfile: mocks.updateProfile,
  }),
}))

vi.mock('../../store/ui', () => ({
  useUi: (selector: (state: unknown) => unknown) => selector({ toast: mocks.toast }),
}))

vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
}))

import { AvatarPicker } from './AvatarPicker'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('avatar picker mutation lifecycle', () => {
  it('submits only one avatar update for rapid repeated save clicks', async () => {
    const pending = deferred<PublicUser>()
    mocks.updateProfile.mockReturnValueOnce(pending.promise)
    const onClose = vi.fn()
    const { root } = await renderPicker(onClose)

    await act(async () => {
      randomChoice().click()
      await flushPromises()
    })
    const selected = document.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    expect(selected).not.toBeNull()

    await act(async () => {
      const button = buttonWithText('common.save')
      button.click()
      button.click()
      await flushPromises()
    })

    expect(mocks.updateProfile).toHaveBeenCalledTimes(1)
    expect(mocks.updateProfile).toHaveBeenCalledWith({
      avatarUrl: expect.any(String),
    })
    expect(randomChoice().disabled).toBe(true)

    await act(async () => {
      pending.resolve(user())
      await pending.promise
      await flushPromises()
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => root.unmount())
  })
})

async function renderPicker(onClose: () => void) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(AvatarPicker, {
      open: true,
      onClose,
      displayName: 'Owner',
      preference: '',
    }))
    await flushPromises()
  })
  return { root }
}

function randomChoice(): HTMLButtonElement {
  const match = document.body.querySelector('[aria-label="settings.random_avatar_number"]')
  if (!(match instanceof HTMLButtonElement)) throw new Error('Missing random avatar choice')
  return match
}

function buttonWithText(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.includes(label))
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
  return match
}

function user(): PublicUser {
  return {
    id: '01K00000000000000000000000',
    login: 'owner',
    username: 'owner',
    name: 'Owner',
    avatarUrl: '',
    role: 'owner',
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
