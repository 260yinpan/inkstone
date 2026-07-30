export function selectMarkdownTab(button: HTMLButtonElement): void {
  const tabs = button.closest<HTMLElement>('[data-tabs]')
  if (!tabs) return
  const index = button.dataset.tabButton
  tabs.querySelectorAll<HTMLButtonElement>('[data-tab-button]').forEach((candidate) => {
    const selected = candidate === button
    candidate.setAttribute('aria-selected', String(selected))
    candidate.tabIndex = selected ? 0 : -1
  })
  tabs.querySelectorAll<HTMLElement>('[data-tab-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== index
  })
}

export function moveMarkdownTabFocus(button: HTMLButtonElement, key: string): void {
  const buttons = [
    ...(button.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[data-tab-button]') ?? []),
  ]
  if (!buttons.length) return
  const current = Math.max(0, buttons.indexOf(button))
  const index =
    key === 'Home'
      ? 0
      : key === 'End'
        ? buttons.length - 1
        : (current + (key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
  const next = buttons[index]!
  selectMarkdownTab(next)
  next.focus()
}
