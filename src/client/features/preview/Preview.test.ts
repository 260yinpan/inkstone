import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { NoteSummary } from '@shared/types'
import { useNotes } from '../../store/notes'
import { useUi } from '../../store/ui'
import { t } from '../../lib/i18n'
import { Preview } from './Preview'

describe('preview task interaction', () => {
  it('writes the browser-toggled checkbox state back to the exact source line', async () => {
    const previousNotes = useNotes.getState()
    const previousUi = useUi.getState()
    const editContent = vi.fn()
    const source = '- [ ] click me'
    const noteId = 'preview-task-test'
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    useNotes.setState({
      notes: {
        [noteId]: {
          id: noteId,
          title: 'Task test',
        } as NoteSummary,
      },
      contents: { [noteId]: source },
      editContent,
    })
    useUi.setState({ activeNoteId: noteId })

    try {
      await act(async () => {
        root.render(createElement(Preview, { content: source }))
      })
      const checkbox = container.querySelector<HTMLInputElement>('input.task-list-item-checkbox')
      expect(checkbox).not.toBeNull()

      await act(async () => {
        checkbox!.click()
      })

      expect(editContent).toHaveBeenCalledOnce()
      expect(editContent).toHaveBeenCalledWith(noteId, '- [x] click me')
      expect(checkbox!.checked).toBe(true)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      useNotes.setState(previousNotes, true)
      useUi.setState(previousUi, true)
    }
  })

  it('does not scroll a stale wiki-link target after another note becomes active', async () => {
    const previousNotes = useNotes.getState()
    const previousUi = useUi.getState()
    const pending = deferred<void>()
    const openNote = vi.fn(() => pending.promise)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    useNotes.setState({
      notes: {
        source: { id: 'source', title: 'Source' } as NoteSummary,
        target: { id: 'target', title: 'Target' } as NoteSummary,
        other: { id: 'other', title: 'Other' } as NoteSummary,
      },
      openNote,
    })
    useUi.setState({ activeNoteId: 'source' })

    try {
      await act(async () => {
        root.render(createElement(Preview, { content: '[[Target#Section]]' }))
      })
      const heading = document.createElement('h2')
      heading.id = 'section'
      heading.scrollIntoView = vi.fn()
      container.querySelector('[data-preview-content]')!.append(heading)

      await act(async () => {
        container.querySelector<HTMLElement>('[data-wikilink]')!.click()
      })
      useUi.setState({ activeNoteId: 'other' })
      await act(async () => pending.resolve())

      expect(openNote).toHaveBeenCalledWith('target')
      expect(heading.scrollIntoView).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
      useNotes.setState(previousNotes, true)
      useUi.setState(previousUi, true)
    }
  })

  it('creates a missing wiki-link note without stealing focus after navigation changed', async () => {
    const previousNotes = useNotes.getState()
    const previousUi = useUi.getState()
    const pending = deferred<string | null>()
    const createNote = vi.fn(() => pending.promise)
    const openNote = vi.fn(async () => undefined)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    useNotes.setState({
      notes: {
        source: { id: 'source', title: 'Source' } as NoteSummary,
        other: { id: 'other', title: 'Other' } as NoteSummary,
      },
      createNote,
      openNote,
    })
    useUi.setState({ activeNoteId: 'source' })

    try {
      await act(async () => {
        root.render(createElement(Preview, { content: '[[Missing]]' }))
      })
      await act(async () => {
        container.querySelector<HTMLElement>('[data-wikilink]')!.click()
      })
      useUi.setState({ activeNoteId: 'other' })
      await act(async () => pending.resolve('created'))

      expect(createNote).toHaveBeenCalledWith({ content: '# Missing\n\n', open: false })
      expect(openNote).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
      useNotes.setState(previousNotes, true)
      useUi.setState(previousUi, true)
    }
  })

  it('keeps repeated copy feedback visible for the full delay after the latest copy', async () => {
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
        root.render(createElement(Preview, { content: '```text\ncopy me\n```' }))
      })
      const copy = container.querySelector<HTMLButtonElement>('[data-copy]')!
      expect(copy).not.toBeNull()

      vi.useFakeTimers()
      await act(async () => copy.click())
      expect(writeText).toHaveBeenCalledWith('copy me\n')
      expect(copy.textContent).toBe(t('common.copied'))

      await act(async () => vi.advanceTimersByTime(500))
      await act(async () => copy.click())
      await act(async () => vi.advanceTimersByTime(500))
      expect(copy.textContent).toBe(t('common.copied'))

      await act(async () => vi.advanceTimersByTime(400))
      expect(copy.textContent).toBe(t('common.copy'))
    } finally {
      await act(async () => root.unmount())
      vi.useRealTimers()
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
