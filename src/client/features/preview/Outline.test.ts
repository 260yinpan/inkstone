import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { Outline } from './Outline'

describe('preview outline', () => {
  it('shows a single heading in a fixed inline column', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onSelect = vi.fn()
    const heading = { level: 1, text: 'Only heading', slug: 'only-heading', line: 0 }

    try {
      await act(async () => {
        root.render(createElement(Outline, { headings: [heading], onSelect }))
      })
      const outline = container.querySelector<HTMLElement>('nav')!
      expect(outline).not.toBeNull()
      expect(outline.className).toContain('shrink-0')
      expect(outline.className).not.toContain('absolute')
      expect(outline.textContent).toContain('Only heading')
      expect(outline.querySelector<HTMLButtonElement>('button')?.type).toBe('button')

      await act(async () => {
        outline.querySelector<HTMLButtonElement>('button')!.click()
      })
      expect(onSelect).toHaveBeenCalledWith(heading)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
