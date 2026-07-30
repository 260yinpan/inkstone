import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { Resizer } from './Resizer'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

describe('resize pointer lifecycle', () => {
  it('ignores non-primary buttons and restores document styles when capture is lost', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onChange = vi.fn()
    const originalCursor = document.body.style.cursor
    const originalUserSelect = document.body.style.userSelect

    try {
      await act(async () => {
        root.render(createElement(Resizer, {
          label: 'Resize',
          value: 200,
          min: 100,
          max: 300,
          onChange,
        }))
      })

      const handle = container.querySelector<HTMLElement>('[role="separator"]')!
      const setPointerCapture = vi.fn()
      Object.defineProperties(handle, {
        setPointerCapture: { configurable: true, value: setPointerCapture },
        hasPointerCapture: { configurable: true, value: vi.fn(() => false) },
        releasePointerCapture: { configurable: true, value: vi.fn() },
      })

      await act(async () => {
        handle.dispatchEvent(pointerEvent('pointerdown', { button: 2 }))
      })
      expect(setPointerCapture).not.toHaveBeenCalled()
      expect(document.body.style.cursor).toBe(originalCursor)
      expect(document.body.style.userSelect).toBe(originalUserSelect)

      await act(async () => {
        handle.dispatchEvent(pointerEvent('pointerdown', { button: 0 }))
      })
      expect(setPointerCapture).toHaveBeenCalledWith(7)
      expect(document.body.style.cursor).toBe('col-resize')
      expect(document.body.style.userSelect).toBe('none')

      await act(async () => {
        handle.dispatchEvent(pointerEvent('lostpointercapture', { button: 0 }))
      })
      expect(document.body.style.cursor).toBe('')
      expect(document.body.style.userSelect).toBe('')
    } finally {
      await act(async () => root.unmount())
      container.remove()
      document.body.style.cursor = originalCursor
      document.body.style.userSelect = originalUserSelect
    }
  })
})

function pointerEvent(type: string, options: { button: number }): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: 7 },
    pointerType: { value: 'mouse' },
    isPrimary: { value: true },
    button: { value: options.button },
    clientX: { value: 120 },
  })
  return event
}
