import { act, createElement, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { previewSourceAnchors } from '../preview/preview-anchors'
import {
  buildScrollCurve,
  measurePreviewAnchors,
  previewTopForLine,
  scrollEdge,
  sourceLineForPreviewTop,
  useSyncScroll,
} from './sync-scroll'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('split-view scroll anchors', () => {
  it('ignores source lines rendered inside an embedded note', () => {
    const preview = document.createElement('div')
    preview.innerHTML = `
      <div data-preview-content>
        <h1 data-line="0">Title</h1>
        <div data-line="4">
          Before embed
          <div class="note-embed-body">
            <h2 data-line="0">Embedded title</h2>
            <p data-line="80">Embedded body</p>
          </div>
        </div>
        <h2 data-line="10">Next section</h2>
      </div>
    `

    expect(previewSourceAnchors(preview).map((element) => Number(element.dataset.line))).toEqual([
      0,
      4,
      10,
    ])
  })

  it('does not map a position near the first line to a nested anchor near the bottom', () => {
    const preview = document.createElement('div')
    preview.scrollTop = 200
    preview.innerHTML = `
      <div data-preview-content>
        <h1 data-line="0">Title</h1>
        <div data-line="4">
          Text
          <div class="note-embed-body"><h2 data-line="0">Embedded title</h2></div>
        </div>
        <h2 data-line="10">Next section</h2>
      </div>
    `

    mockTop(preview, 100)
    const [title, paragraph, next] = previewSourceAnchors(preview)
    mockTop(title!, -88)
    mockTop(paragraph!, 20)
    mockTop(next!, 300)
    mockTop(preview.querySelector<HTMLElement>('.note-embed-body h2')!, 900)

    const measured = measurePreviewAnchors(preview)
    const curve = buildScrollCurve(measured, 20, 12, 1_000)

    expect(measured).toEqual([
      { line: 0, top: 12 },
      { line: 4, top: 120 },
      { line: 10, top: 400 },
    ])
    expect(previewTopForLine(curve, 0.8)).toBeCloseTo(33.6)
    expect(previewTopForLine(curve, 0.8)).toBeLessThan(100)
  })

  it('builds one monotonic curve with explicit top and bottom endpoints', () => {
    const curve = buildScrollCurve(
      [
        { line: 0, top: 900 },
        { line: 4, top: 120 },
        { line: 3, top: 800 },
        { line: 10, top: 600 },
        { line: 10, top: 700 },
        { line: 30, top: 900 },
      ],
      20,
      12,
      800,
    )

    expect(curve).toEqual([
      { line: 0, top: 12 },
      { line: 4, top: 120 },
      { line: 10, top: 600 },
      { line: 20, top: 812 },
    ])

    for (let line = 0; line <= 20; line += 0.25) {
      const previous = previewTopForLine(curve, Math.max(0, line - 0.25))
      expect(previewTopForLine(curve, line)).toBeGreaterThanOrEqual(previous)
    }
    for (let top = 12; top <= 812; top += 10) {
      const previous = sourceLineForPreviewTop(curve, Math.max(12, top - 10))
      expect(sourceLineForPreviewTop(curve, top)).toBeGreaterThanOrEqual(previous)
    }
    for (const anchor of curve) {
      expect(previewTopForLine(curve, anchor.line)).toBeCloseTo(anchor.top)
      expect(sourceLineForPreviewTop(curve, anchor.top)).toBeCloseTo(anchor.line)
    }
  })

  it('treats a non-scrollable pane as top, not bottom', () => {
    expect(scrollEdge(0, 0)).toBe('top')
    expect(scrollEdge(0, 500)).toBe('top')
    expect(scrollEdge(250, 500)).toBeNull()
    expect(scrollEdge(498.5, 500)).toBe('bottom')
  })

  it('lets the pane with user input drive without feeding the target scroll back', async () => {
    const container = document.createElement('div')
    const editor = document.createElement('div')
    document.body.append(container, editor)
    const root = createRoot(container)
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = ++frameId
      frames.set(id, callback)
      return id
    })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id)
    })
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    setScrollMetrics(editor, 0, 100, 1_100)
    const view = fakeEditorView(editor)

    const runFrames = () => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach((callback) => callback(performance.now()))
    }

    try {
      await act(async () => root.render(createElement(SyncHarness, { view })))
      const preview = container.querySelector<HTMLElement>('[data-preview-scroller]')!
      setScrollMetrics(preview, 0, 100, 1_100)
      mockTop(preview, 100)
      const [title, paragraph, next] = previewSourceAnchors(preview)
      mockTop(title!, 112)
      mockTop(paragraph!, 220)
      mockTop(next!, 500)
      mockTop(preview.querySelector<HTMLElement>('.note-embed-body h2')!, 1_000)

      await act(async () => {
        editor.dispatchEvent(new Event('wheel', { bubbles: true }))
        editor.scrollTop = 40
        editor.dispatchEvent(new Event('scroll'))
        runFrames()
      })

      expect(preview.scrollTop).toBeCloseTo(24)
      expect(preview.scrollTop).toBeLessThan(100)

      await act(async () => {
        preview.dispatchEvent(new Event('scroll'))
        runFrames()
      })
      expect(editor.scrollTop).toBe(40)

      await act(async () => {
        preview.dispatchEvent(new Event('wheel', { bubbles: true }))
        preview.scrollTop = 0
        preview.dispatchEvent(new Event('scroll'))
        runFrames()
      })
      expect(editor.scrollTop).toBe(0)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      editor.remove()
      requestFrame.mockRestore()
      cancelFrame.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})

function SyncHarness({ view }: { view: EditorView }) {
  const previewRef = useRef<HTMLDivElement>(null)
  useSyncScroll(view, previewRef, true)
  return createElement(
    'div',
    { ref: previewRef, 'data-preview-scroller': '' },
    createElement(
      'div',
      { 'data-preview-content': '' },
      createElement('h1', { 'data-line': '0' }, 'Title'),
      createElement(
        'div',
        { 'data-line': '4' },
        'Text',
        createElement(
          'div',
          { className: 'note-embed-body' },
          createElement('h2', { 'data-line': '0' }, 'Embedded title'),
        ),
      ),
      createElement('h2', { 'data-line': '10' }, 'Next section'),
    ),
  )
}

function fakeEditorView(editor: HTMLElement): EditorView {
  const block = (line: number) => ({ from: line, top: line * 50, height: 50 })
  return {
    scrollDOM: editor,
    state: {
      doc: {
        lines: 20,
        lineAt: (position: number) => ({ number: Math.min(20, position + 1) }),
        line: (number: number) => ({ from: number - 1 }),
      },
    },
    lineBlockAtHeight: (top: number) => block(Math.min(19, Math.max(0, Math.floor(top / 50)))),
    lineBlockAt: (position: number) => block(Math.min(19, Math.max(0, position))),
  } as unknown as EditorView
}

function setScrollMetrics(
  element: HTMLElement,
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): void {
  Object.defineProperties(element, {
    scrollTop: { configurable: true, writable: true, value: scrollTop },
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, value: scrollHeight },
  })
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function mockTop(element: HTMLElement, top: number): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: top,
    top,
    right: 0,
    bottom: top,
    left: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  })
}
