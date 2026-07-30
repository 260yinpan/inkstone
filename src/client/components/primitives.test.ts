import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { resolveAvatarSource } from '../lib/avatar'
import { Avatar, Button } from './primitives'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

describe('avatar', () => {
  it('falls back to the generated avatar after an image error and retries a changed source', async () => {
    const broken = 'data:image/png;base64,broken'
    const replacement = 'data:image/webp;base64,replacement'
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => root.render(createElement(Avatar, { src: broken, name: 'Alice' })))
      const image = container.querySelector('img')!
      expect(image.getAttribute('src')).toBe(broken)

      await act(async () => image.dispatchEvent(new Event('error')))
      expect(image.getAttribute('src')).toBe(resolveAvatarSource(null, 'Alice'))

      await act(async () => root.render(
        createElement(Avatar, { src: replacement, name: 'Alice' }),
      ))
      expect(image.getAttribute('src')).toBe(replacement)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})

describe('button', () => {
  it('exposes its loading state and blocks another activation', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => root.render(createElement(Button, { loading: true }, 'Save')))
      const button = container.querySelector('button')!
      expect(button.disabled).toBe(true)
      expect(button.getAttribute('aria-busy')).toBe('true')
      expect(button.textContent).toBe('Save')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
