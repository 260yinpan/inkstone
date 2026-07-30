import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { PublicNote } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { readShare, enhancePreview, renderPendingMermaid, resetMermaidNode } = vi.hoisted(() => ({
  readShare: vi.fn(),
  enhancePreview: vi.fn(() => Promise.resolve()),
  renderPendingMermaid: vi.fn(() => Promise.resolve()),
  resetMermaidNode: vi.fn(),
}))

vi.mock('../../lib/api', () => {
  class MockApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
      readonly details?: unknown,
    ) {
      super(message)
      this.name = 'ApiError'
    }
  }
  return {
    ApiError: MockApiError,
    api: { share: { read: readShare } },
  }
})

vi.mock('../../lib/markdown/renderer', () => ({
  renderMarkdown: (content: string) => ({
    html: content.startsWith('<') ? content : `<p>${content}</p>`,
  }),
}))

vi.mock('../../lib/markdown/enhance', () => ({
  enhancePreview,
  renderPendingMermaid,
  resetMermaidNode,
}))

import { ApiError } from '../../lib/api'
import { t } from '../../lib/i18n'
import { SharePage } from './SharePage'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.clearAllMocks()
})

describe('public share request lifecycle', () => {
  it('cannot let a stale slug response replace the current share and restores the page title', async () => {
    const first = deferred<PublicNote>()
    const second = deferred<PublicNote>()
    readShare.mockImplementation((slug: string) => slug === 'first' ? first.promise : second.promise)
    const originalTitle = 'Original page'
    document.title = originalTitle
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(createElement(SharePage, { slug: 'first' }))
      })
      await act(async () => {
        root.render(createElement(SharePage, { slug: 'second' }))
      })
      await act(async () => {
        second.resolve(publicNote('Current note'))
        await second.promise
      })
      expect(container.textContent).toContain('Current note')
      expect(document.title).toBe('Current note · Inkstone')

      await act(async () => {
        first.resolve(publicNote('Stale note'))
        await first.promise
      })
      expect(container.textContent).not.toContain('Stale note')
      expect(document.title).toBe('Current note · Inkstone')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }

    expect(document.title).toBe(originalTitle)
  })

  it('leaves the passcode form when a later request says the share is unavailable', async () => {
    readShare
      .mockRejectedValueOnce(new ApiError(401, 'password_required', 'Password required'))
      .mockRejectedValueOnce(new ApiError(404, 'not_found', 'Share is gone'))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(createElement(SharePage, { slug: 'protected' }))
      })
      const input = container.querySelector<HTMLInputElement>('input[type="password"]')!
      expect(input.maxLength).toBe(128)
      expect(input.autocomplete).toBe('current-password')

      await act(async () => {
        setInputValue(input, 'secret')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        container.querySelector<HTMLFormElement>('form')!.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        )
      })

      expect(container.querySelector('form')).toBeNull()
      expect(container.textContent).toContain('Share is gone')
      expect(container.querySelector('[role="alert"]')?.textContent).toBe('Share is gone')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('activates public code copy, tabs, and Mermaid rendering', async () => {
    readShare.mockResolvedValue(
      publicNote(
        'Interactive note',
        '<div class="code-block"><button type="button" data-copy>Copy</button><pre>hello</pre></div>' +
          '<div data-tabs><div role="tablist"><button type="button" role="tab" data-tab-button="0" aria-selected="true" tabindex="0">One</button><button type="button" role="tab" data-tab-button="1" aria-selected="false" tabindex="-1">Two</button></div><section data-tab-panel="0">First</section><section data-tab-panel="1" hidden>Second</section></div>' +
          '<div data-mermaid="diagram"><button type="button" data-mermaid-retry>Retry</button></div>',
      ),
    )
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(createElement(SharePage, { slug: 'interactive' }))
        await flushPromises()
      })
      expect(enhancePreview).toHaveBeenCalledOnce()
      expect(renderPendingMermaid).toHaveBeenCalledOnce()

      const copy = container.querySelector<HTMLButtonElement>('[data-copy]')!
      await act(async () => copy.click())
      expect(writeText).toHaveBeenCalledWith('hello')
      expect(copy.textContent).toBe(t('common.copied'))

      const tabs = [...container.querySelectorAll<HTMLButtonElement>('[data-tab-button]')]
      await act(async () => tabs[1]!.click())
      expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
      expect(container.querySelector<HTMLElement>('[data-tab-panel="0"]')?.hidden).toBe(true)
      expect(container.querySelector<HTMLElement>('[data-tab-panel="1"]')?.hidden).toBe(false)

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-mermaid-retry]')!.click()
        await flushPromises()
      })
      expect(resetMermaidNode).toHaveBeenCalledOnce()
      expect(renderPendingMermaid).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
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

function publicNote(title: string, content = title): PublicNote {
  return {
    title,
    content,
    createdAt: 1,
    updatedAt: 1,
    author: { name: 'Author', avatarUrl: '' },
    site: { name: 'Inkstone' },
    share: { slug: 'share-slug' },
  }
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
}
