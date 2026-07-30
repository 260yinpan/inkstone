import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  graph: vi.fn(),
  openNote: vi.fn(),
  onClose: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: { graph: mocks.graph },
}))

vi.mock('../../store/notes', () => ({
  useNotes: (selector: (state: unknown) => unknown) => selector({ openNote: mocks.openNote }),
}))

vi.mock('../../store/ui', () => ({
  useUi: (selector: (state: unknown) => unknown) => selector({ activeNoteId: null }),
}))

vi.mock('../../lib/i18n', () => ({
  t: (key: string) => key,
}))

import { GraphPanel, graphScaleAfterWheel } from './GraphPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('graph loading', () => {
  it('ignores horizontal-only and invalid wheel deltas', () => {
    expect(graphScaleAfterWheel(1, 0)).toBe(1)
    expect(graphScaleAfterWheel(1, Number.NaN)).toBe(1)
    expect(graphScaleAfterWheel(1, 1)).toBeLessThan(1)
    expect(graphScaleAfterWheel(1, -1)).toBeGreaterThan(1)
  })

  it('distinguishes a request failure from an empty graph and can retry', async () => {
    mocks.graph
      .mockRejectedValueOnce(new Error('offline now'))
      .mockResolvedValueOnce({ nodes: [], edges: [] })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(GraphPanel, { onClose: mocks.onClose }))
      await flushPromises()
    })

    expect(document.body.textContent).toContain('graph.could_not_load_graph')
    expect(document.body.textContent).toContain('offline now')
    expect(document.body.textContent).not.toContain('graph.nothing_to_graph_yet')
    expect(buttonByLabel('graph.reset').disabled).toBe(true)

    const retry = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent === 'common.retry')
    expect(retry).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      retry!.click()
      await flushPromises()
    })

    expect(mocks.graph).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('graph.nothing_to_graph_yet')
    expect(buttonByLabel('graph.reset').disabled).toBe(true)
    await act(async () => root.unmount())
  })

  it('opens a node only for a primary-button click', async () => {
    mocks.graph.mockResolvedValueOnce({
      nodes: [{ id: 'node-1', title: 'First', degree: 0 }],
      edges: [],
    })
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext())
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(createElement(GraphPanel, { onClose: mocks.onClose }))
        await flushPromises()
      })
      const canvas = document.body.querySelector('canvas')!

      await act(async () => {
        canvas.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          button: 2,
          clientX: 100,
          clientY: 50,
        }))
        canvas.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true,
          button: 2,
          clientX: 100,
          clientY: 50,
        }))
      })
      expect(mocks.openNote).not.toHaveBeenCalled()
      expect(mocks.onClose).not.toHaveBeenCalled()

      await act(async () => {
        canvas.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 50,
        }))
        canvas.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 50,
        }))
      })
      expect(mocks.openNote).toHaveBeenCalledWith('node-1')
      expect(mocks.onClose).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = document.body.querySelector(`[aria-label="${label}"]`)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`)
  return button
}

function canvasContext(): CanvasRenderingContext2D {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}
