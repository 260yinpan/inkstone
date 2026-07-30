import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LAYOUT, PANEL_WIDTHS, applyThemeToDom, switchThemeWithTransition, useUi } from './ui'

describe('UI layout defaults', () => {
  it('starts both left panels at their resizable minimum and leaves the split automatic', () => {
    expect(DEFAULT_LAYOUT).toEqual({
      navWidth: PANEL_WIDTHS.navigation.min,
      listWidth: PANEL_WIDTHS.noteList.min,
      splitRatio: null,
    })
  })
})

describe('mobile note opening', () => {
  it('opens a selected note in preview while keeping manual pane switching available', () => {
    const previousState = useUi.getState()

    try {
      useUi.setState({ mobilePane: 'editor', activeNoteId: null })
      useUi.getState().setActiveNote('note-1')

      expect(useUi.getState().mobilePane).toBe('preview')

      useUi.getState().setMobilePane('editor')
      expect(useUi.getState().mobilePane).toBe('editor')
    } finally {
      useUi.setState(previousState, true)
    }
  })
})

describe('UI appearance transitions', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.documentElement.classList.remove('theme-transition')
  })

  it('does not let an old fallback timer cut off a newer theme transition', () => {
    const previousState = useUi.getState()
    const previousStored = localStorage.getItem('inkstone.ui')
    const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false }) as MediaQueryList,
    })
    vi.useFakeTimers()

    try {
      switchThemeWithTransition('dark')
      vi.advanceTimersByTime(200)
      switchThemeWithTransition('light')
      vi.advanceTimersByTime(100)
      expect(document.documentElement.classList.contains('theme-transition')).toBe(true)

      vi.advanceTimersByTime(200)
      expect(document.documentElement.classList.contains('theme-transition')).toBe(false)
    } finally {
      useUi.setState(previousState, true)
      applyThemeToDom(previousState)
      vi.runOnlyPendingTimers()
      if (previousStored === null) localStorage.removeItem('inkstone.ui')
      else localStorage.setItem('inkstone.ui', previousStored)
      if (matchMediaDescriptor) Object.defineProperty(window, 'matchMedia', matchMediaDescriptor)
      else Reflect.deleteProperty(window, 'matchMedia')
    }
  })

  it('runs a supplied settings commit as the transition mutation', () => {
    const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false }) as MediaQueryList,
    })
    const commit = vi.fn()

    try {
      switchThemeWithTransition('dark', undefined, commit)
      expect(commit).toHaveBeenCalledOnce()
    } finally {
      if (matchMediaDescriptor) Object.defineProperty(window, 'matchMedia', matchMediaDescriptor)
      else Reflect.deleteProperty(window, 'matchMedia')
    }
  })
})
