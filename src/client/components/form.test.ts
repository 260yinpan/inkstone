import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { Field, Input, Segmented, Slider } from './form'

describe('form accessibility', () => {
  it('connects a Field label and hint to its control', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          createElement(Field, {
            label: 'Name',
            hint: 'Public label',
            required: true,
            children: createElement(Input, { defaultValue: 'Inkstone' }),
          }),
        )
      })
      const label = container.querySelector('label')!
      const input = container.querySelector('input')!
      const hint = container.querySelector('p')!
      expect(label.htmlFor).toBe(input.id)
      expect(input.getAttribute('aria-labelledby')).toBe(label.id)
      expect(input.getAttribute('aria-describedby')).toBe(hint.id)
      expect(input.getAttribute('aria-required')).toBe('true')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('uses radio semantics and arrow-key movement for segmented choices', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onChange = vi.fn()

    try {
      await act(async () => {
        root.render(
          createElement(Segmented, {
            value: 'one',
            label: 'Layout',
            onChange,
            options: [
              { value: 'one', label: 'One' },
              { value: 'two', label: 'Two' },
            ],
          }),
        )
      })
      const group = container.querySelector<HTMLElement>('[role="radiogroup"]')!
      const radios = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      expect(group.getAttribute('aria-label')).toBe('Layout')
      expect(radios[0]?.getAttribute('aria-checked')).toBe('true')
      expect(radios[1]?.tabIndex).toBe(-1)

      radios[0]?.focus()
      await act(async () => {
        radios[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      })
      expect(onChange).toHaveBeenCalledWith('two')
      expect(document.activeElement).toBe(radios[1])
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('exposes visual input errors to assistive technology', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(createElement(Input, { invalid: true }))
      })
      expect(container.querySelector('input')?.getAttribute('aria-invalid')).toBe('true')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('keeps segmented choices keyboard reachable when the current value is unknown', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          createElement(Segmented, {
            value: 'removed',
            onChange: vi.fn(),
            options: [
              { value: 'one', label: 'One' },
              { value: 'two', label: 'Two' },
            ],
          }),
        )
      })
      const radios = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1])
      expect(radios.every((radio) => radio.getAttribute('aria-checked') === 'false')).toBe(true)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('disables every choice when a segmented control is busy', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          createElement(Segmented, {
            value: 'one',
            disabled: true,
            onChange: vi.fn(),
            options: [
              { value: 'one', label: 'One' },
              { value: 'two', label: 'Two' },
            ],
          }),
        )
      })
      expect(container.querySelector('[role="radiogroup"]')?.getAttribute('aria-disabled')).toBe('true')
      expect(
        [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].every(
          (radio) => radio.disabled,
        ),
      ).toBe(true)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('keeps the slider fill percentage finite and within its track', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          createElement(Slider, {
            value: 20,
            min: 0,
            max: 10,
            onChange: vi.fn(),
          }),
        )
      })
      expect(container.querySelector<HTMLInputElement>('input')?.style.getPropertyValue('--pct')).toBe('100%')

      await act(async () => {
        root.render(
          createElement(Slider, {
            value: 10,
            min: 10,
            max: 10,
            onChange: vi.fn(),
          }),
        )
      })
      expect(container.querySelector<HTMLInputElement>('input')?.style.getPropertyValue('--pct')).toBe('0%')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
