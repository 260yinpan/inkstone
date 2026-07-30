import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmHost, Menu, Modal, Tooltip, confirm } from './overlay'
import { Button, IconButton } from './primitives'

describe('dialog keyboard behavior', () => {
  it('skips a disabled autofocus target', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          createElement(
            Modal,
            {
              open: true,
              onClose: vi.fn(),
              title: 'Dialog title',
              children: createElement(
                'div',
                null,
                createElement('button', { disabled: true, 'data-autofocus': true }, 'disabled'),
                createElement('button', { id: 'available-action' }, 'available'),
              ),
            },
          ),
        )
      })

      const disabled = document.querySelector<HTMLButtonElement>('[data-autofocus]')!
      const firstAvailable = document.querySelector<HTMLElement>('[role="dialog"] button:not([disabled])')!
      expect(document.activeElement).not.toBe(disabled)
      expect(document.activeElement).toBe(firstAvailable)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('prioritizes autofocus, traps Tab, and restores the trigger', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'open'
    document.body.append(trigger)
    trigger.focus()

    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          createElement(
            Modal,
            {
              open: true,
              onClose: vi.fn(),
              title: 'Dialog title',
              footer: createElement('button', { id: 'last-action' }, 'last'),
              children: createElement(
                'button',
                { id: 'primary-action', 'data-autofocus': true },
                'primary',
              ),
            },
          ),
        )
      })

      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
      const close = dialog.querySelector<HTMLElement>('button[aria-label]')!
      const primary = document.querySelector<HTMLElement>('#primary-action')!
      const last = document.querySelector<HTMLElement>('#last-action')!
      expect(document.activeElement).toBe(primary)

      last.focus()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      expect(document.activeElement).toBe(close)

      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
      )
      expect(document.activeElement).toBe(last)
    } finally {
      await act(async () => root.unmount())
      expect(document.activeElement).toBe(trigger)
      container.remove()
      trigger.remove()
    }
  })
})

describe('confirmation queue', () => {
  it('does not let a double click confirm the next queued request', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(createElement(ConfirmHost))
      })

      let first!: Promise<boolean>
      let second!: Promise<boolean>
      await act(async () => {
        first = confirm({ title: 'First request' })
        second = confirm({ title: 'Second request' })
      })
      const secondResult = vi.fn()
      void second.then(secondResult)

      await act(async () => {
        const button = document.querySelector<HTMLButtonElement>('[data-autofocus]')!
        button.click()
        button.click()
        await Promise.resolve()
      })

      await expect(first).resolves.toBe(true)
      expect(secondResult).not.toHaveBeenCalled()
      expect(document.body.textContent).toContain('Second request')

      await act(async () => {
        const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
        buttons.at(-2)!.click()
        await Promise.resolve()
      })
      await expect(second).resolves.toBe(false)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})

describe('shared buttons', () => {
  it('defaults to a non-submitting button while preserving explicit submit', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          createElement(
            'div',
            null,
            createElement(Button, { id: 'default-button' }, 'default'),
            createElement(Button, { id: 'submit-button', type: 'submit' }, 'submit'),
          ),
        )
      })
      expect(document.querySelector<HTMLButtonElement>('#default-button')?.type).toBe('button')
      expect(document.querySelector<HTMLButtonElement>('#submit-button')?.type).toBe('submit')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('keeps icon labels accessible without creating a native browser tooltip', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(createElement(IconButton, { label: 'Settings' }, 'icon'))
      })
      const button = container.querySelector('button')!
      expect(button.getAttribute('aria-label')).toBe('Settings')
      expect(button.getAttribute('title')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})

describe('menu keyboard behavior', () => {
  it('uses roving focus and checkbox semantics', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onSelect = vi.fn()
    const onClose = vi.fn()

    try {
      await act(async () => {
        root.render(
          createElement(Menu, {
            open: true,
            anchor: { x: 10, y: 10 },
            onClose,
            items: [
              { id: 'one', label: 'One' },
              { id: 'two', label: 'Two', checked: false, onSelect },
            ],
          }),
        )
      })

      const first = document.querySelector<HTMLElement>('[data-menu-index="0"]')!
      const second = document.querySelector<HTMLElement>('[data-menu-index="1"]')!
      expect(document.activeElement).toBe(first)
      expect(second.getAttribute('role')).toBe('menuitemcheckbox')
      expect(second.getAttribute('aria-checked')).toBe('false')

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      })
      expect(document.activeElement).toBe(second)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
      expect(onSelect).toHaveBeenCalledOnce()
      expect(onClose).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})

describe('tooltip positioning', () => {
  it('measures the real trigger and flips above when the bottom has no room', async () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const width = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    const height = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 220 })
    const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this instanceof HTMLElement && this.getAttribute('role') === 'tooltip') {
        return testRect(0, 0, 100, 30)
      }
      if (this instanceof HTMLElement && this.id === 'tooltip-trigger') {
        return testRect(100, 180, 20, 20)
      }
      return testRect(0, 0, 0, 0)
    })

    try {
      await act(async () => {
        root.render(
          createElement(
            Tooltip,
            {
              label: 'Shortcut',
              delay: 0,
              children: createElement('button', { id: 'tooltip-trigger' }, 'Icon'),
            },
          ),
        )
      })
      await act(async () => {
        document.querySelector<HTMLButtonElement>('#tooltip-trigger')!.dispatchEvent(
          new MouseEvent('mouseover', { bubbles: true }),
        )
        vi.runAllTimers()
      })

      const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!
      expect(tooltip).not.toBeNull()
      expect(tooltip.dataset.side).toBe('top')
      expect(tooltip.style.top).toBe('143px')
      expect(tooltip.style.left).toBe('60px')
      expect(tooltip.style.visibility).toBe('visible')
    } finally {
      await act(async () => root.unmount())
      container.remove()
      measure.mockRestore()
      if (width) Object.defineProperty(window, 'innerWidth', width)
      if (height) Object.defineProperty(window, 'innerHeight', height)
      vi.useRealTimers()
    }
  })
})

function testRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect
}
