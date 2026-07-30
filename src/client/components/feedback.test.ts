import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { LoadingBlock } from './feedback'

describe('feedback accessibility', () => {
  it('announces a loading label without exposing the decorative spinner', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => root.render(createElement(LoadingBlock, { label: 'Loading notes' })))
      const status = container.querySelector<HTMLElement>('[role="status"]')!
      expect(status.textContent).toContain('Loading notes')
      expect(status.getAttribute('aria-live')).toBe('polite')
      expect(status.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
