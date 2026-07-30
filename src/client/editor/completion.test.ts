import { CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { tagSource, wikiLinkSource, type CompletionSources } from './completion'

function context(doc: string): CompletionContext {
  const state = EditorState.create({ doc })
  return new CompletionContext(state, doc.length, true)
}

describe('live Markdown completion sources', () => {
  it('reads the latest note list without rebuilding the editor extension', () => {
    let current: CompletionSources = {
      notes: () => [{ id: '1', title: 'Old note', excerpt: '' }],
      tags: () => [],
    }
    const source = wikiLinkSource(() => current)

    expect(source(context('[['))?.options.map((option) => option.label)).toContain('Old note')
    current = {
      notes: () => [{ id: '2', title: 'New note', excerpt: '' }],
      tags: () => [],
    }
    const labels = source(context('[['))?.options.map((option) => option.label)
    expect(labels).toContain('New note')
    expect(labels).not.toContain('Old note')
  })

  it('reads the latest tag list and stops completion beyond the supported length', () => {
    let tags = [{ name: 'first', count: 1 }]
    const source = tagSource(() => ({ notes: () => [], tags: () => tags }))

    expect(source(context('#f'))?.options.map((option) => option.label)).toEqual(['first'])
    tags = [{ name: 'fresh', count: 2 }]
    expect(source(context('#f'))?.options.map((option) => option.label)).toEqual(['fresh'])
    expect(source(context(`#${'a'.repeat(61)}`))).toBeNull()
  })
})
