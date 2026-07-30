export function previewSourceAnchors(root: HTMLElement): HTMLElement[] {
  const content = root.matches('[data-preview-content]')
    ? root
    : root.querySelector<HTMLElement>('[data-preview-content]')
  if (!content) return []

  return [...content.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.hasAttribute('data-line'),
  )
}
