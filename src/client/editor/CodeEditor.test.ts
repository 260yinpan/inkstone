import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/constants'
import { CodeEditor } from './CodeEditor'
import { insertFiles, uploadedFileMarkdown } from './paste'

describe('controlled CodeEditor updates', () => {
  it('does not send store-provided content back as a second user edit', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onChange = vi.fn()
    let view: EditorView | null = null
    const common = {
      onChange,
      settings: DEFAULT_SETTINGS.editor,
      sources: { notes: () => [], tags: () => [] },
      handlers: { uploadFile: async () => null },
      onReady: (next: EditorView | null) => {
        view = next
      },
    }

    try {
      await act(async () => {
        root.render(createElement(CodeEditor, { ...common, value: 'first' }))
      })
      await act(async () => {
        root.render(createElement(CodeEditor, { ...common, value: 'external update' }))
      })

      expect(view!.state.doc.toString()).toBe('external update')
      expect(onChange).not.toHaveBeenCalled()

      await act(async () => {
        view!.dispatch({ changes: { from: view!.state.doc.length, insert: '!' } })
      })
      expect(onChange).toHaveBeenCalledOnce()
      expect(onChange).toHaveBeenCalledWith('external update!')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('keeps Ctrl+B inside the editor as Markdown bold', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onChange = vi.fn()
    let view: EditorView | null = null
    const originalClientRects = Range.prototype.getClientRects
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [] as unknown as DOMRectList,
    })

    try {
      await act(async () => {
        root.render(createElement(CodeEditor, {
          value: 'word',
          onChange,
          settings: DEFAULT_SETTINGS.editor,
          sources: { notes: () => [], tags: () => [] },
          handlers: { uploadFile: async () => null },
          onReady: (next: EditorView | null) => { view = next },
        }))
      })
      view!.dispatch({ selection: { anchor: 0, head: 4 } })

      await act(async () => {
        view!.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'b',
          code: 'KeyB',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }))
      })

      expect(view!.state.doc.toString()).toBe('**word**')
      expect(onChange).toHaveBeenLastCalledWith('**word**')
    } finally {
      await act(async () => root.unmount())
      container.remove()
      if (originalClientRects) {
        Object.defineProperty(Range.prototype, 'getClientRects', {
          configurable: true,
          value: originalClientRects,
        })
      } else {
        delete (Range.prototype as Partial<Range>).getClientRects
      }
    }
  })

  it('writes a finished upload back through the detached-note handler after switching editors', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let view: EditorView | null = null
    let resolveUpload!: (value: { url: string; filename: string; isImage: boolean }) => void
    const upload = new Promise<{ url: string; filename: string; isImage: boolean }>((resolve) => {
      resolveUpload = resolve
    })
    const replaceDetachedUpload = vi.fn()

    await act(async () => {
      root.render(createElement(CodeEditor, {
        value: '',
        onChange: vi.fn(),
        settings: DEFAULT_SETTINGS.editor,
        sources: { notes: () => [], tags: () => [] },
        handlers: { uploadFile: async () => null },
        onReady: (next: EditorView | null) => { view = next },
      }))
    })

    const result = { url: '/api/files/a%20b', filename: 'a]b.png', isImage: true }
    const pending = insertFiles(view!, [new File(['x'], 'a]b.png')], {
      uploadFile: () => upload,
      replaceDetachedUpload,
    })
    await act(async () => root.unmount())
    resolveUpload(result)
    await pending

    expect(replaceDetachedUpload).toHaveBeenCalledOnce()
    expect(replaceDetachedUpload.mock.calls[0]?.[0]).toContain('inkstone-upload:')
    expect(replaceDetachedUpload.mock.calls[0]?.[1]).toBe(uploadedFileMarkdown(result))
    expect(uploadedFileMarkdown(result)).toBe('![a\\]b](</api/files/a%20b>)')
    container.remove()
  })

  it('journals every file placeholder before parallel uploads can finish', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let view: EditorView | null = null
    const onChange = vi.fn()
    const resolvers: Array<(value: { url: string; filename: string; isImage: boolean }) => void> = []
    const uploadFile = vi.fn(() => new Promise<{ url: string; filename: string; isImage: boolean }>((resolve) => {
      resolvers.push(resolve)
    }))
    const replaceDetachedUpload = vi.fn()

    await act(async () => {
      root.render(createElement(CodeEditor, {
        value: '',
        onChange,
        settings: DEFAULT_SETTINGS.editor,
        sources: { notes: () => [], tags: () => [] },
        handlers: { uploadFile: async () => null },
        onReady: (next: EditorView | null) => { view = next },
      }))
    })

    let pending!: Promise<void>
    await act(async () => {
      pending = insertFiles(
        view!,
        [new File(['a'], 'same.png'), new File(['b'], 'same.png')],
        { uploadFile, replaceDetachedUpload },
      )
      await Promise.resolve()
    })
    const staged = view!.state.doc.toString()
    const placeholders = [...staged.matchAll(/!\[[^\]]+\]\(\)<!-- inkstone-upload:[^>]+ -->/g)].map((match) => match[0])
    expect(placeholders).toHaveLength(2)
    expect(new Set(placeholders).size).toBe(2)
    expect(uploadFile).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenLastCalledWith(staged)

    await act(async () => root.unmount())
    resolvers[1]!({ url: '/api/files/second', filename: 'second.png', isImage: true })
    resolvers[0]!({ url: '/api/files/first', filename: 'first.png', isImage: true })
    await pending

    expect(replaceDetachedUpload).toHaveBeenCalledTimes(2)
    expect(replaceDetachedUpload.mock.calls.map((call) => call[0]).sort()).toEqual(placeholders.sort())
    expect(replaceDetachedUpload.mock.calls.map((call) => call[1]).sort()).toEqual([
      '![first](</api/files/first>)',
      '![second](</api/files/second>)',
    ])
    container.remove()
  })

  it('clears the exposed editor view when the editor is destroyed', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onReady = vi.fn<(view: EditorView | null) => void>()

    await act(async () => {
      root.render(createElement(CodeEditor, {
        value: '',
        onChange: vi.fn(),
        settings: DEFAULT_SETTINGS.editor,
        sources: { notes: () => [], tags: () => [] },
        handlers: { uploadFile: async () => null },
        onReady,
      }))
    })
    expect(onReady.mock.calls[0]?.[0]).not.toBeNull()

    await act(async () => root.unmount())

    expect(onReady).toHaveBeenLastCalledWith(null)
    container.remove()
  })

  it('keeps spellcheck disabled when editor settings recreate the view', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let view: EditorView | null = null
    const common = {
      value: '',
      onChange: vi.fn(),
      sources: { notes: () => [], tags: () => [] },
      handlers: { uploadFile: async () => null },
      onReady: (next: EditorView | null) => { view = next },
    }
    const settings = { ...DEFAULT_SETTINGS.editor, spellcheck: false, lineNumbers: false }

    try {
      await act(async () => {
        root.render(createElement(CodeEditor, { ...common, settings }))
      })
      expect(view!.contentDOM.spellcheck).toBe(false)

      await act(async () => {
        root.render(createElement(CodeEditor, {
          ...common,
          settings: { ...settings, lineNumbers: true },
        }))
      })

      expect(view!.contentDOM.spellcheck).toBe(false)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
