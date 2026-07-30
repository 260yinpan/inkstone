


export interface Hotkey {
  id: string

  combo: string
  description: string | (() => string)
  group: string | (() => string)
  handler: (event: KeyboardEvent) => void

  allowInInput?: boolean

  hidden?: boolean
}

const registry = new Map<string, Hotkey>()
let bound = false

export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

export function register(hotkey: Hotkey): () => void {
  registry.set(hotkey.id, hotkey)
  ensureBound()
  return () => {
    if (registry.get(hotkey.id) === hotkey) registry.delete(hotkey.id)
  }
}

export function registerAll(hotkeys: Hotkey[]): () => void {
  const disposers = hotkeys.map(register)
  return () => disposers.forEach((d) => d())
}

export function listHotkeys(): Hotkey[] {
  return [...registry.values()].filter((h) => !h.hidden)
}

export function hotkeyText(value: string | (() => string)): string {
  return typeof value === 'function' ? value() : value
}

function ensureBound(): void {
  if (bound || typeof window === 'undefined') return
  bound = true
  window.addEventListener('keydown', onKeyDown, { capture: true })
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.isComposing || event.repeat) return
  const inInput = isEditableTarget(event.target)

  for (const hotkey of registry.values()) {
    if (!matches(event, hotkey.combo)) continue
    if (inInput && !hotkey.allowInInput) continue
    event.preventDefault()
    event.stopPropagation()
    hotkey.handler(event)
    return
  }
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (el.isContentEditable) return true
  return Boolean(el.closest?.('.cm-editor'))
}

function matches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+')
  const key = parts[parts.length - 1]!

  const wantMod = parts.includes('mod')
  const wantShift = parts.includes('shift')
  const wantAlt = parts.includes('alt')
  const wantCtrl = parts.includes('ctrl')

  const expectedCtrl = wantCtrl || (!IS_MAC && wantMod)
  const expectedMeta = IS_MAC && wantMod
  if (event.ctrlKey !== expectedCtrl || event.metaKey !== expectedMeta) return false


  const symbolKey = key.length === 1 && !/[a-z0-9]/.test(key)
  if (!symbolKey && wantShift !== event.shiftKey) return false
  if (wantAlt !== event.altKey) return false

  const pressed = event.key.toLowerCase()
  if (pressed === key) return true

  if (key.length === 1 && event.code.toLowerCase() === `key${key}`) return true
  if (key.length === 1 && event.code.toLowerCase() === `digit${key}`) return true
  if (key === 'esc' && pressed === 'escape') return true
  return false
}

export function prettyCombo(combo: string): string[] {
  return combo.split('+').map((part) => {
    switch (part.toLowerCase()) {
      case 'mod':
        return IS_MAC ? '⌘' : 'Ctrl'
      case 'shift':
        return IS_MAC ? '⇧' : 'Shift'
      case 'alt':
        return IS_MAC ? '⌥' : 'Alt'
      case 'ctrl':
        return IS_MAC ? '⌃' : 'Ctrl'
      case 'escape':
      case 'esc':
        return 'Esc'
      case 'enter':
        return '↵'
      case 'backspace':
        return IS_MAC ? '⌫' : 'Backspace'
      case 'arrowup':
        return '↑'
      case 'arrowdown':
        return '↓'
      case 'arrowleft':
        return '←'
      case 'arrowright':
        return '→'
      case ',':
        return ','
      default:
        return part.length === 1 ? part.toUpperCase() : part
    }
  })
}
