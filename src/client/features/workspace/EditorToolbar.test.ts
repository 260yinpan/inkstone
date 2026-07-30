import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { setLocale } from '../../lib/i18n'
import { ZH_CN_MESSAGES } from '@shared/locales/zh-CN'
import { EditorToolbar } from './EditorToolbar'

describe('editor Markdown toolbar', () => {
  it('exposes every extended syntax group and runs its commands', async () => {
    setLocale('zh-CN', false)
    const container = document.createElement('div')
    const editorHost = document.createElement('div')
    document.body.append(container, editorHost)
    const root = createRoot(container)
    const originalClientRects = Range.prototype.getClientRects
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [] as unknown as DOMRectList,
    })
    const view = new EditorView({
      state: EditorState.create({ doc: 'Note', selection: { anchor: 0, head: 4 } }),
      parent: editorHost,
    })

    try {
      await act(async () => {
        root.render(createElement(EditorToolbar, { view, onPickImage: () => undefined }))
      })

      expect(container.querySelector(`[aria-label="${ZH_CN_MESSAGES['workspace.more_inline_styles']}"]`)).not.toBeNull()
      expect(container.querySelector(`[aria-label="${ZH_CN_MESSAGES['workspace.note_syntax']}"]`)).not.toBeNull()
      expect(container.querySelector(`[aria-label="${ZH_CN_MESSAGES['workspace.more_blocks']}"]`)).not.toBeNull()

      await act(async () => {
        container.querySelector<HTMLButtonElement>(`[aria-label="${ZH_CN_MESSAGES['workspace.note_syntax']}"]`)!.click()
      })
      const noteLabels = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')]
        .map((item) => item.textContent)
      expect(noteLabels).toEqual(expect.arrayContaining([
        ZH_CN_MESSAGES['common.wiki_links'],
        ZH_CN_MESSAGES['workspace.note_embed'],
        ZH_CN_MESSAGES['workspace.remote_image'],
        ZH_CN_MESSAGES['workspace.insert_tag'],
        ZH_CN_MESSAGES['workspace.block_id'],
        ZH_CN_MESSAGES['workspace.block_reference'],
        ZH_CN_MESSAGES['workspace.footnote'],
      ]))

      const wikiLink = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')]
        .find((item) => item.textContent === ZH_CN_MESSAGES['common.wiki_links'])!
      await act(async () => wikiLink.click())
      expect(view.state.doc.toString()).toBe('[[Note]]')

      await act(async () => {
        container.querySelector<HTMLButtonElement>(`[aria-label="${ZH_CN_MESSAGES['workspace.more_blocks']}"]`)!.click()
      })
      const blockLabels = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')]
        .map((item) => item.textContent)
      expect(blockLabels).toEqual(expect.arrayContaining([
        ZH_CN_MESSAGES['workspace.definition_list'],
        ZH_CN_MESSAGES['workspace.mermaid_diagram'],
        ZH_CN_MESSAGES['workspace.enhanced_code_block'],
        ZH_CN_MESSAGES['workspace.callout'],
        ZH_CN_MESSAGES['workspace.details_block'],
        ZH_CN_MESSAGES['common.tabs'],
        ZH_CN_MESSAGES['workspace.pandoc_attributes'],
        'Front Matter',
      ]))
    } finally {
      await act(async () => root.unmount())
      view.destroy()
      container.remove()
      editorHost.remove()
      if (originalClientRects) {
        Object.defineProperty(Range.prototype, 'getClientRects', {
          configurable: true,
          value: originalClientRects,
        })
      }
    }
  })
})
