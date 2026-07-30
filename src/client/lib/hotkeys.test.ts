import { describe, expect, it, vi } from 'vitest'
import { register } from './hotkeys'

describe('global hotkey modifier matching', () => {
  it('does not let an old disposer remove a newer registration with the same id', () => {
    const oldHandler = vi.fn()
    const newHandler = vi.fn()
    const disposeOld = register({
      id: 'test-replaced-registration',
      combo: 'ctrl+j',
      description: 'old',
      group: 'test',
      handler: oldHandler,
    })
    const disposeNew = register({
      id: 'test-replaced-registration',
      combo: 'ctrl+j',
      description: 'new',
      group: 'test',
      handler: newHandler,
    })

    try {
      disposeOld()
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'j',
        code: 'KeyJ',
        ctrlKey: true,
        bubbles: true,
      }))
      expect(oldHandler).not.toHaveBeenCalled()
      expect(newHandler).toHaveBeenCalledOnce()
    } finally {
      disposeNew()
    }
  })

  it('supports an explicit Ctrl modifier on every platform', () => {
    const handler = vi.fn()
    const dispose = register({
      id: 'test-explicit-ctrl',
      combo: 'ctrl+k',
      description: 'test',
      group: 'test',
      handler,
    })

    try {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'k',
        code: 'KeyK',
        ctrlKey: true,
        bubbles: true,
      }))
      expect(handler).toHaveBeenCalledOnce()
    } finally {
      dispose()
    }
  })

  it('does not match a Mod shortcut when an extra primary modifier is held', () => {
    const handler = vi.fn()
    const dispose = register({
      id: 'test-exact-mod',
      combo: 'mod+k',
      description: 'test',
      group: 'test',
      handler,
    })

    try {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'k',
        code: 'KeyK',
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
      }))
      expect(handler).not.toHaveBeenCalled()
    } finally {
      dispose()
    }
  })

  it('ignores repeated keydown events for one-shot global actions', () => {
    const handler = vi.fn()
    const dispose = register({
      id: 'test-ignore-repeat',
      combo: 'ctrl+n',
      description: 'test',
      group: 'test',
      handler,
    })

    try {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'n',
        code: 'KeyN',
        ctrlKey: true,
        repeat: true,
        bubbles: true,
      }))
      expect(handler).not.toHaveBeenCalled()
    } finally {
      dispose()
    }
  })
})
