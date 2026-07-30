import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '../../lib/i18n'
import { relativeTime } from '../../lib/time'
import { useNotes } from '../../store/notes'
import { SaveIndicator } from './SaveIndicator'

afterEach(() => {
  vi.useRealTimers()
})

describe('save indicator', () => {
  it('exposes the complete offline state to assistive technology', async () => {
    const previousNotes = useNotes.getState()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    useNotes.setState({ online: false, saveStatus: 'offline', pendingCount: 3 })

    try {
      await act(async () => root.render(createElement(SaveIndicator)))

      const status = container.querySelector<HTMLElement>('[role="img"]')!
      expect(status.getAttribute('aria-label')).toBe(
        t('shell.offline_value0_changes_pending', { value0: 3 }),
      )
    } finally {
      await act(async () => root.unmount())
      container.remove()
      useNotes.setState(previousNotes, true)
    }
  })

  it('refreshes the synced relative-time label as time passes', async () => {
    const previousNotes = useNotes.getState()
    const now = new Date('2026-07-30T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const lastSavedAt = now.getTime() - 30_000
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    useNotes.setState({
      online: true,
      saveStatus: 'synced',
      pendingCount: 0,
      lastSavedAt,
    })

    try {
      await act(async () => root.render(createElement(SaveIndicator)))
      const status = container.querySelector<HTMLElement>('[role="img"]')!
      expect(status.getAttribute('aria-label')).toBe(
        t('shell.synced_value0', { value0: relativeTime(lastSavedAt) }),
      )

      await act(async () => vi.advanceTimersByTime(60_000))

      expect(status.getAttribute('aria-label')).toBe(
        t('shell.synced_value0', { value0: relativeTime(lastSavedAt) }),
      )

      await act(async () => vi.advanceTimersByTime(30_001))

      expect(status.getAttribute('aria-label')).toBe(
        t('shell.synced_value0', { value0: relativeTime(lastSavedAt) }),
      )
    } finally {
      await act(async () => root.unmount())
      container.remove()
      useNotes.setState(previousNotes, true)
    }
  })
})
