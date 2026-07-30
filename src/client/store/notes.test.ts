import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { NoteSummary } from '@shared/types'

vi.mock('../lib/db', () => ({
  localDb: {
    setContent: vi.fn(async () => undefined),
    scheduleShellSave: vi.fn(),
    enqueueOutbox: vi.fn(async () => undefined),
  },
  publishBroadcast: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  CLIENT_ID: 'test-client',
  api: {},
  ApiError: class ApiError extends Error {},
}))

import { useNavigationCounts, useNotes } from './notes'

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('note editing update boundaries', () => {
  it('updates content immediately but coalesces shell metadata into one stable update', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const id = 'coalesced-note'
    const note: NoteSummary = {
      id,
      title: 'Old title',
      excerpt: '',
      folderId: null,
      tags: [],
      isPinned: false,
      isStarred: false,
      isArchived: false,
      wordCount: 0,
      charCount: 0,
      rev: 1,
      position: 0,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    }
    useNotes.setState({
      notes: { [id]: note },
      contents: { [id]: '# Old title' },
      saveStatus: 'idle',
    })

    let noteIndexChanges = 0
    const unsubscribe = useNotes.subscribe((state, previous) => {
      if (state.notes !== previous.notes) noteIndexChanges++
    })

    try {
      const edit = useNotes.getState().editContent
      edit(id, '# New title\n\nbody #zeta')
      edit(id, '# New title\n\nbody #zeta #alpha')
      edit(id, '# New title\n\nbody #zeta #alpha done')

      expect(useNotes.getState().contents[id]).toBe('# New title\n\nbody #zeta #alpha done')
      expect(useNotes.getState().notes[id]).toBe(note)
      expect(noteIndexChanges).toBe(0)

      vi.advanceTimersByTime(70)

      expect(noteIndexChanges).toBe(1)
      expect(useNotes.getState().notes[id]).toMatchObject({
        title: 'New title',
        tags: ['alpha', 'zeta'],
        updatedAt: 10_000,
      })

      const stateAfterDerivation = useNotes.getState()
      edit(id, stateAfterDerivation.contents[id]!)
      expect(useNotes.getState()).toBe(stateAfterDerivation)
      expect(noteIndexChanges).toBe(1)
    } finally {
      unsubscribe()
    }
  })

  it('does not rerender navigation counts for content-only summary changes', async () => {
    const id = 'navigation-projection-note'
    const note: NoteSummary = {
      id,
      title: 'Before',
      excerpt: '',
      folderId: null,
      tags: ['alpha'],
      isPinned: false,
      isStarred: false,
      isArchived: false,
      wordCount: 1,
      charCount: 6,
      rev: 1,
      position: 0,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    }
    useNotes.setState({ notes: { [id]: note }, contents: { [id]: 'Before' } })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let renders = 0
    function Probe() {
      useNavigationCounts()
      renders++
      return null
    }

    try {
      await act(async () => root.render(createElement(Probe)))
      expect(renders).toBe(1)

      await act(async () => {
        useNotes.setState((state) => ({
          notes: {
            ...state.notes,
            [id]: { ...state.notes[id]!, title: 'After', tags: ['beta'], wordCount: 2, updatedAt: 2 },
          },
        }))
      })
      expect(renders).toBe(1)

      await act(async () => {
        useNotes.setState((state) => ({
          notes: { ...state.notes, [id]: { ...state.notes[id]!, isStarred: true } },
        }))
      })
      expect(renders).toBe(2)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
