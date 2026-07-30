import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { t } from '../../lib/i18n'
import { useUi } from '../../store/ui'
import { Lightbox } from './Lightbox'

describe('image lightbox', () => {
  it('shows a useful failure state and recovers for the next image', async () => {
    const previousUi = useUi.getState()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    useUi.setState({ lightbox: { src: '/broken.png', alt: 'Broken' } })

    try {
      await act(async () => root.render(createElement(Lightbox)))
      const image = document.body.querySelector<HTMLImageElement>('[role="dialog"] img')!
      expect(image).not.toBeNull()
      expect(image.classList.contains('cursor-zoom-in')).toBe(true)

      await act(async () => image.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
      expect(image.style.transform).toBe('scale(2)')
      expect(image.classList.contains('cursor-zoom-out')).toBe(true)

      await act(async () => image.dispatchEvent(new Event('error')))
      expect(document.body.querySelector('[role="status"]')?.textContent).toContain(
        t('preview.could_not_load_image'),
      )
      expect(
        document.body.querySelector<HTMLButtonElement>(`[aria-label="${t('common.zoom_in')}"]`)
          ?.disabled,
      ).toBe(true)

      await act(async () => {
        useUi.getState().setLightbox({ src: '/working.png', alt: 'Working' })
      })
      expect(document.body.querySelector<HTMLImageElement>('[role="dialog"] img')?.src).toContain(
        '/working.png',
      )
      expect(document.body.querySelector('[role="status"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
      useUi.setState(previousUi, true)
    }
  })
})
